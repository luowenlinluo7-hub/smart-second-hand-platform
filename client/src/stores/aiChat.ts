import { computed, reactive, ref } from 'vue'
import { defineStore } from 'pinia'
import { AiChatAbortError, streamAiChat, type AiChatEvent } from '@/api/aiChat'
import type { Product } from '@/types/api'
import { readCurrentUserId, scopedStorageKey } from '@/utils/currentUser'

// 带版本号的 key：将来消息结构变更时，直接换新 key，
// 老数据自然失效，不会因为格式不兼容导致页面报错。
// 实际存储键会再拼上用户 id（见 storageKey），避免多人共用一个浏览器时串会话。
const CHAT_KEY_PREFIX = 'ai-chat-v1'

// 本地最多保留多少条消息，避免 localStorage 无限增长
const MAX_STORED_MESSAGES = 50

// 送给后端做上下文的历史条数（后端还会再做一次滑动窗口裁剪）
const HISTORY_LIMIT = 8

export type AiChatStatus = 'streaming' | 'done' | 'stopped' | 'error'

export interface AiChatMessage {
  id: string
  role: 'user' | 'assistant'
  // 回答正文（流式累加）
  content: string
  // 思考过程（后端真实步骤，逐条推送）
  thoughts: string[]
  // 本轮命中的商品卡片
  products: Product[]
  productsTotal: number
  relaxedNote: string | null
  suggestions: string[]
  // 本轮解析出的条件，下一轮作为 previousFilters 回传
  parsed: unknown
  status: AiChatStatus
  errorMessage: string | null
  source: string | null
  elapsedMs: number
  createdAt: number
}

const createId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`

const createAssistantMessage = (): AiChatMessage => ({
  id: createId(),
  role: 'assistant',
  content: '',
  thoughts: [],
  products: [],
  productsTotal: 0,
  relaxedNote: null,
  suggestions: [],
  parsed: null,
  status: 'streaming',
  errorMessage: null,
  source: null,
  elapsedMs: 0,
  createdAt: Date.now(),
})

// 读取本地记录：任何解析异常都退回空数组，不让坏数据把助手整个卡死
const readMessages = (key: string): AiChatMessage[] => {
  const raw = localStorage.getItem(key)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // 只保留结构完整的消息
    return parsed.filter(
      (item): item is AiChatMessage =>
        typeof item === 'object' &&
        item !== null &&
        (item as AiChatMessage).role !== undefined &&
        typeof (item as AiChatMessage).content === 'string',
    )
  } catch {
    return []
  }
}

export const useAiChatStore = defineStore('aiChat', () => {
  // 会话归属用户：刷新页面时直接载入当前登录用户自己的对话
  let ownerId: string | null = readCurrentUserId()

  const storageKey = (): string => scopedStorageKey(CHAT_KEY_PREFIX, ownerId)

  const messages = ref<AiChatMessage[]>(readMessages(storageKey()))
  const isStreaming = ref(false)
  // 抽屉开合不持久化：刷新后默认收起，避免一进页面就被浮层挡住
  const drawerOpen = ref(false)
  // 抽屉关闭时收到 AI 回复的条数，用于悬浮球上的红点提示
  const unreadCount = ref(0)

  // 当前用户正在浏览的商品。由商品详情页写入，用于消解「这款」这类指代 ——
  // 绝不让模型从聊天历史里猜「这款」指的是什么。
  const focusProductId = ref<string | null>(null)

  let controller: AbortController | null = null

  const persist = (): void => {
    const trimmed = messages.value.slice(-MAX_STORED_MESSAGES)
    try {
      localStorage.setItem(storageKey(), JSON.stringify(trimmed))
    } catch {
      // 超出配额等情况忽略即可，不影响会话本身
    }
  }

  const hasMessages = computed(() => messages.value.length > 0)

  // 本轮之前已经展示过的商品，用于「还有别的推荐吗」时排除，避免重复推荐
  const shownProductIds = computed(() => {
    const ids = new Set<string>()
    for (const message of messages.value) {
      if (message.role === 'assistant') {
        for (const product of message.products) ids.add(product.id)
      }
    }
    return [...ids]
  })

  // 上一轮解析出的条件，追问时作为底子
  const lastParsed = computed<unknown>(() => {
    for (let i = messages.value.length - 1; i >= 0; i -= 1) {
      const message = messages.value[i]
      if (message.role === 'assistant' && message.parsed) return message.parsed
    }
    return null
  })

  const open = (): void => {
    drawerOpen.value = true
    // 打开即视为已读
    unreadCount.value = 0
  }

  const close = (): void => {
    drawerOpen.value = false
  }

  // 抽屉关闭期间 AI 回复结束 → 记一条未读，提示用户回来看。
  // 红点必须有真实来源，不能靠无意义的循环动画吸引注意力。
  const markUnreadIfClosed = (): void => {
    if (!drawerOpen.value) unreadCount.value += 1
  }

  const toggle = (): void => {
    drawerOpen.value = !drawerOpen.value
  }

  // 停止生成：abort 之后后端 res 的 close 事件才会触发，
  // 从而掐断上游对 DeepSeek 的调用，不再继续计费。
  const stop = (): void => {
    if (controller) {
      controller.abort()
      controller = null
    }
  }

  const applyEvent = (target: AiChatMessage, event: AiChatEvent): void => {
    switch (event.type) {
      case 'thought':
        target.thoughts.push(event.text)
        break
      case 'products':
        target.products = event.items
        target.productsTotal = event.total
        target.relaxedNote = event.relaxedNote
        if (event.parsed) target.parsed = event.parsed
        // 搜索结果的第一件自动成为「当前关注商品」。
        // 后端只有在拿到 focusProductId 时才会启用「这件多少钱 / 成色怎么样 / 能便宜点吗」
        // 这类追问规则；原来只有商品详情页会设置它，导致在首页聊天时这些问法全部失效。
        if (event.items.length > 0) focusProductId.value = event.items[0].id
        break
      case 'delta':
        target.content += event.text
        break
      case 'suggestions':
        target.suggestions = event.items
        break
      case 'done':
        target.source = event.replySource
        target.elapsedMs = event.elapsedMs
        target.errorMessage = event.degraded
        target.status = 'done'
        break
      case 'error':
        target.status = 'error'
        target.errorMessage = event.message
        break
      default:
        break
    }
  }

  const send = async (text: string): Promise<void> => {
    const message = text.trim()
    if (!message || isStreaming.value) return

    messages.value.push({
      id: createId(),
      role: 'user',
      content: message,
      thoughts: [],
      products: [],
      productsTotal: 0,
      relaxedNote: null,
      suggestions: [],
      parsed: null,
      status: 'done',
      errorMessage: null,
      source: null,
      elapsedMs: 0,
      createdAt: Date.now(),
    })

    // 必须用 reactive 包装后再 push：
    // push 进 ref 数组的是**原始对象**，而 applyEvent 直接改这个原始引用，
    // 改原始对象不会触发 Vue 的响应式，导致流式过程中正文/思考/商品卡都不刷新。
    const assistant = reactive(createAssistantMessage())
    messages.value.push(assistant)
    isStreaming.value = true

    // 历史只带文字，不带商品 JSON —— 否则几轮就把 token 撑爆
    const history = messages.value
      .filter((item) => item.id !== assistant.id && item.content)
      .slice(-HISTORY_LIMIT)
      .map((item) => ({ role: item.role, content: item.content }))

    controller = new AbortController()

    try {
      await streamAiChat(
        {
          message,
          history,
          context: {
            focusProductId: focusProductId.value,
            excludeProductIds: shownProductIds.value,
            previousFilters: lastParsed.value,
          },
        },
        (event) => applyEvent(assistant, event),
        controller.signal,
      )
      // 流正常结束但没收到 done（例如后端提前 end），也标记为完成
      if (assistant.status === 'streaming') assistant.status = 'done'
    } catch (error) {
      if (error instanceof AiChatAbortError) {
        assistant.status = 'stopped'
        if (!assistant.content) assistant.content = '已停止生成。'
      } else {
        assistant.status = 'error'
        assistant.errorMessage = error instanceof Error ? error.message : 'AI 服务暂时不可用'
      }
    } finally {
      isStreaming.value = false
      controller = null
      markUnreadIfClosed()
      persist()
    }
  }

  // 清空对话：同时重置上下文，让下一轮回到全新状态
  const clear = (): void => {
    stop()
    messages.value = []
    focusProductId.value = null
    unreadCount.value = 0
    try {
      localStorage.removeItem(storageKey())
    } catch {
      // 忽略
    }
  }

  // 切换账号（登录 / 退出）：中止进行中的流，清掉界面态，载入目标用户自己的会话
  const switchUser = (nextUserId: string | null): void => {
    if (nextUserId === ownerId) return
    stop()
    ownerId = nextUserId
    messages.value = readMessages(storageKey())
    focusProductId.value = null
    unreadCount.value = 0
    drawerOpen.value = false
  }

  const setFocusProduct = (productId: string | null): void => {
    focusProductId.value = productId
  }

  return {
    messages,
    isStreaming,
    drawerOpen,
    unreadCount,
    focusProductId,
    hasMessages,
    open,
    close,
    toggle,
    send,
    stop,
    clear,
    setFocusProduct,
    switchUser,
  }
})
