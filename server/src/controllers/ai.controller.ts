import type { Request, Response } from 'express';
import { z } from 'zod';
import { parseQuery } from '../services/ai.service';
import { searchByAi } from '../services/aiSearch.service';
import { runChat } from '../services/aiChat.service';
import { BizCode, success } from '../utils/response';

const querySchema = z
  .string({ error: '请输入搜索内容' })
  .trim()
  .min(1, '请输入搜索内容')
  .max(100, '搜索内容最多 100 字');

const searchSchema = z.object({
  query: querySchema,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
});

const parseSchema = z.object({ query: querySchema });

// ---------- AI 助手（流式） ----------

const historyMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(2000, '单条历史最多 2000 字'),
});

// 前端会把上一轮解析出的条件回传，供「还有别的吗」这类追问复用
const parsedFiltersSchema = z.object({
  category: z.object({ id: z.string().min(1), name: z.string().min(1) }).nullable(),
  condition: z.enum(['NEW', 'LIKE_NEW', 'GOOD', 'FAIR']).nullable(),
  conditionLabel: z.string().max(20).nullable(),
  priceMin: z.number().nonnegative().nullable(),
  priceMax: z.number().nonnegative().nullable(),
  keyword: z.string().max(50),
});

const chatSchema = z.object({
  message: z
    .string({ error: '请输入内容' })
    .trim()
    .min(1, '请输入内容')
    .max(200, '单条消息最多 200 字'),
  history: z.array(historyMessageSchema).max(50, '历史消息过多').optional(),
  context: z
    .object({
      // 用户当前关注（打开 / 点击）的商品，用于消解「这款」这类指代
      focusProductId: z.string().min(1).nullable().optional(),
      // 已经展示过的商品，避免「还有其他吗」反复推同一件
      excludeProductIds: z.array(z.string().min(1)).max(100).optional(),
      previousFilters: parsedFiltersSchema.nullable().optional(),
    })
    .optional(),
});

// POST /api/ai/search —— 自然语言搜索商品（一次性返回）
export const search = async (req: Request, res: Response): Promise<void> => {
  const input = searchSchema.parse(req.body);
  const result = await searchByAi(input);
  res.json(success(result));
};

// POST /api/ai/parse —— 只解析条件、不查库，便于调试提示词效果
export const parse = async (req: Request, res: Response): Promise<void> => {
  const input = parseSchema.parse(req.body);
  const outcome = await parseQuery(input.query);
  res.json(success({ parsed: outcome.filters, source: outcome.source, note: outcome.note }));
};

// 心跳间隔：防止中间代理把长时间没有数据的连接掐掉。
// Vercel 的 rewrite 代理与多数 CDN 对「静默连接」都比较敏感，
// 10s 一次注释帧既够轻（每帧 8 字节），又能稳定保活。
const HEARTBEAT_MS = 10_000;

// POST /api/ai/chat —— AI 导购助手（SSE 流式）
//
// ⚠️ 本接口是「统一响应信封 { code, message, data }」的显式例外：
// 流式响应无法用一个 JSON 信封承载，因此改用 SSE 事件流传输。
// 事件定义见 server/docs/api-contract.md 4.5 节。
export const chat = async (req: Request, res: Response): Promise<void> => {
  // 校验必须放在写 SSE 头之前 —— 此时出错仍能返回普通 JSON 信封
  const input = chatSchema.parse(req.body);

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // 关掉 Nginx / Vercel 等反向代理的缓冲，否则流会被攒起来一次性下发
  res.setHeader('X-Accel-Buffering', 'no');
  // 显式声明不压缩：一旦中间层启用 gzip/br，压缩器会攒够一批再输出，
  // 流式效果立刻退化成「一次性蹦出来」。identity 表示不做内容编码。
  res.setHeader('Content-Encoding', 'identity');
  res.flushHeaders();

  const send = (event: string, data: unknown): void => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // 立即写一帧注释（SSE 规范里以 ':' 开头会被客户端忽略）：
  // 让代理与浏览器「立刻」确认这是一条已建立的流，而不是在等首个字节。
  // 首包越早，代理越不会因为「迟迟没有响应体」而超时断开。
  // 若服务器挂了 compression 中间件，flush 能保证这一帧真的发出去。
  res.write(': stream-open\n\n');
  (res as Response & { flush?: () => void }).flush?.();

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) {
      res.write(': ping\n\n');
      (res as Response & { flush?: () => void }).flush?.();
    }
  }, HEARTBEAT_MS);


  const controller = new AbortController();
  // 用户点「停止生成」或关闭页面时触发：
  // 必须把上游的模型调用一起掐断，否则会继续为 token 付费。
  //
  // 注意监听 res 而不是 req：Node 里 IncomingMessage 的 'close' 在请求体读完后
  // 就可能触发（express.json() 已经读完 body），用它判断"客户端断开"会误判成
  // 立即断开，从而把正常的模型流一起掐掉。ServerResponse 的 'close' 才反映连接状态。
  res.on('close', () => {
    // 正常结束时 writableEnded 已经是 true；只有客户端提前断开才会走到这里
    if (!res.writableEnded) controller.abort();
  });

  try {
    const outcome = await runChat(
      input,
      {
        thought: (text) => send('thought', { text }),
        products: (payload) => send('products', payload),
        delta: (text) => send('delta', { text }),
        suggestions: (items) => send('suggestions', { items }),
      },
      controller.signal,
    );

    send('done', outcome);
  } catch (error) {
    // 客户端已经断开时不要再写事件：写了也没人收，还可能抛错
    if (!controller.signal.aborted) {
      send('error', {
        code: BizCode.SERVER_ERROR,
        message: error instanceof Error ? error.message : '服务暂时不可用',
      });
    }
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
};
