import type { Product } from '@/types/api'

// 后端地址，与 request.ts 保持同一套拼接规则：末尾斜杠剥掉，本地不配则走 Vite 代理
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')

// AI 助手的流式客户端
//
// 为什么不用 EventSource：
//   1) EventSource 只支持 GET，无法 POST 传消息体
//   2) EventSource 不能自定义请求头，带不了 Authorization
// 为什么不用 axios：
//   浏览器的 XHR 适配器拿不到增量数据，axios 也没有真正的流式 API
//   （onDownloadProgress 只在部分环境可用且有缓冲），
//   而项目的 axios 拦截器还会按 { code, message, data } 信封拆包 ——
//   流式响应根本不是那个形状，必须在拦截器之外单独处理。

// 后端推送的事件（与 server/docs/api-contract.md 4.5.1 一致）
export type AiChatEvent =
  | { type: 'thought'; text: string }
  | {
      type: 'products'
      items: Product[]
      total: number
      weak: boolean
      relaxedNote: string | null
      parsed: unknown
    }
  | { type: 'delta'; text: string }
  | { type: 'suggestions'; items: string[] }
  | {
      type: 'done'
      parseSource: string | null
      replySource: string
      degraded: string | null
      elapsedMs: number
      total: number
    }
  | { type: 'error'; code: number; message: string }

export interface AiChatHistoryItem {
  role: 'user' | 'assistant'
  content: string
}

export interface AiChatContext {
  focusProductId?: string | null
  excludeProductIds?: string[]
  previousFilters?: unknown
}

export interface AiChatRequest {
  message: string
  history?: AiChatHistoryItem[]
  context?: AiChatContext
}

// ---------- 事件解析 ----------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const asString = (value: unknown): string => (typeof value === 'string' ? value : '')

const asNumber = (value: unknown): number => (typeof value === 'number' ? value : 0)

// 解析单个 SSE 事件块。
// 一个块形如：
//   event: thought
//   data: {"text":"..."}
//
// 规范允许一个事件有多个 data: 行（用换行拼接），也允许以 ':' 开头的注释行
// （后端每 15 秒发的 `: ping` 心跳就是这种，必须忽略）。
const parseEventChunk = (chunk: string): AiChatEvent | null => {
  let eventName = 'message'
  const dataLines: string[] = []

  for (const line of chunk.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    // SSE 规范：冒号后若紧跟一个空格，需去掉这一个空格（不是 trim）
    if (value.startsWith(' ')) value = value.slice(1)

    if (field === 'event') eventName = value
    else if (field === 'data') dataLines.push(value)
  }

  if (dataLines.length === 0) return null

  let payload: unknown
  try {
    payload = JSON.parse(dataLines.join('\n'))
  } catch {
    return null
  }
  if (!isRecord(payload)) return null

  switch (eventName) {
    case 'thought':
      return { type: 'thought', text: asString(payload.text) }
    case 'delta':
      return { type: 'delta', text: asString(payload.text) }
    case 'products':
      return {
        type: 'products',
        items: Array.isArray(payload.items) ? (payload.items as Product[]) : [],
        total: asNumber(payload.total),
        weak: payload.weak === true,
        relaxedNote: typeof payload.relaxedNote === 'string' ? payload.relaxedNote : null,
        parsed: payload.parsed ?? null,
      }
    case 'suggestions':
      return {
        type: 'suggestions',
        items: Array.isArray(payload.items) ? payload.items.map(asString).filter(Boolean) : [],
      }
    case 'done':
      return {
        type: 'done',
        parseSource: typeof payload.parseSource === 'string' ? payload.parseSource : null,
        replySource: asString(payload.replySource),
        degraded: typeof payload.degraded === 'string' ? payload.degraded : null,
        elapsedMs: asNumber(payload.elapsedMs),
        total: asNumber(payload.total),
      }
    case 'error':
      return {
        type: 'error',
        code: asNumber(payload.code),
        message: asString(payload.message) || 'AI 服务暂时不可用',
      }
    default:
      return null
  }
}

// ---------- 流式请求 ----------

export class AiChatAbortError extends Error {
  constructor() {
    super('已停止生成')
    this.name = 'AiChatAbortError'
  }
}

export const streamAiChat = async (
  body: AiChatRequest,
  onEvent: (event: AiChatEvent) => void,
  signal: AbortSignal,
): Promise<void> => {
  const token = localStorage.getItem('token')

  // 与 axios 实例共用同一后端地址，本地未配变量时为空串，请求 /api/... 走 Vite 代理
  const response = await fetch(`${API_BASE_URL}/api/ai/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  })

  const contentType = response.headers.get('content-type') ?? ''

  // 参数校验失败(400)与限流(429)发生在事件流开始之前，仍是普通 JSON 信封。
  // 这种情况必须当错误抛出，而不是当成流去读 —— 否则会静默收到空结果。
  if (!response.ok || !contentType.includes('text/event-stream')) {
    let message = `请求失败（HTTP ${response.status}）`
    try {
      const payload: unknown = await response.json()
      if (isRecord(payload) && typeof payload.message === 'string') message = payload.message
    } catch {
      // 响应体不是 JSON 就沿用默认文案
    }
    throw new Error(message)
  }
  if (!response.body) throw new Error('服务端没有返回可读流')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break

      // stream: true 很关键：一个中文 UTF-8 字符占 3 字节，
      // 可能正好被 TCP 分包切开，不带这个参数会解出乱码
      buffer += decoder.decode(value, { stream: true })

      // SSE 用空行分隔事件。网络上一次到达的数据不保证是完整事件，
      // 所以最后一个片段要留在 buffer 里，与下一批数据拼接后再解析。
      const chunks = buffer.split(/\r?\n\r?\n/)
      buffer = chunks.pop() ?? ''

      for (const chunk of chunks) {
        const event = parseEventChunk(chunk)
        if (event) onEvent(event)
      }
    }

    // 流结束时 buffer 里可能还有一个没被空行终止的事件
    if (buffer.trim()) {
      const event = parseEventChunk(buffer)
      if (event) onEvent(event)
    }
  } catch (error) {
    // 主动 abort 统一转成 AI 专用错误，便于上层区分「用户停止」与「真的失败」
    if (signal.aborted) throw new AiChatAbortError()
    throw error
  }
}