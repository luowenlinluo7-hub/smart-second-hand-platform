// AI 导购助手：三阶段管线
//
//   ① 解析条件   —— 复用 parseQuery()（规则 / 模型 / 超时降级都已具备），
//                   立刻推送 thought，用户 100ms 内就能看到"它在想什么"
//   ② 检索商品   —— 相关性排序 + 逐级放宽，推送 products（数据全部来自数据库）
//   ③ 生成回答   —— 模型只负责"把已经查好的结果说成人话"，流式推送 delta
//
// 关键设计：思考过程与商品数据都不依赖模型。
// 因此模型超时 / 断网时，用户依然能看到「思考过程 + 商品卡片」，
// 只有回答退化为本地话术 —— 这也是答辩离线演示能保持完整体验的原因。

import { CONDITION_LABELS } from './aiRuleParser';
import { parseQuery, isEmptyFilters, type ParsedFilters, type ParseSource } from './ai.service';
import { searchWithRelaxation } from './aiSearch.service';
import { expandKeywordVariants } from './searchSynonyms';
import {
  averagePriceOfCategory,
  findProductById,
  listSellerOtherProducts,
  searchProductsRanked,
  type ProductDTO,
} from './product.service';
import { env } from '../config/env';
import {
  AI_REPLY_SYSTEM_PROMPT,
  buildReplyUserBlock,
  type ReplyContext,
  type ReplyProductBrief,
} from '../utils/prompt';

// ---------- 输入 ----------

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatContext {
  // 用户当前打开 / 点过的商品，用于消解「这款」这类指代。绝不靠模型从历史里猜。
  focusProductId?: string | null;
  // 已经展示过的商品，避免"还有其他吗"反复推同一件
  excludeProductIds?: string[];
  // 上一轮解析出的条件，供"还有别的吗""换成手机"这类追问复用
  previousFilters?: ParsedFilters | null;
}

export interface ChatInput {
  message: string;
  history?: ChatHistoryMessage[];
  context?: ChatContext;
}

// ---------- 输出（与传输层解耦，controller 负责接到 res.write） ----------

export interface ChatProductsPayload {
  items: ProductDTO[];
  total: number;
  weak: boolean;
  relaxedNote: string | null;
  // 本轮识别出的条件。前端需要把它存下来，下一轮作为 previousFilters 回传，
  // 否则「还有别的推荐吗」这类追问会丢掉上一轮的筛选条件。
  parsed: ParsedFilters;
}

export interface ChatSink {
  thought: (text: string) => void;
  products: (payload: ChatProductsPayload) => void;
  delta: (text: string) => void;
  suggestions: (items: string[]) => void;
}

export interface ChatOutcome {
  // 条件来源；针对「这件成色怎么样」这类细节提问不会解析条件，此时为 null
  parseSource: ParseSource | null;
  // 回答来源
  replySource: ParseSource;
  degraded: string | null;
  elapsedMs: number;
  total: number;
}

// 助手里一次最多展示几件商品（比搜索页少，避免聊天窗被卡片淹没）
const CHAT_PRODUCT_LIMIT = 6;
// 送进提示词的商品条数（模型不需要看全部）
const PROMPT_PRODUCT_LIMIT = 5;

// 细节类提问不解析条件时使用的空条件
const EMPTY_FILTERS: ParsedFilters = {
  category: null,
  condition: null,
  conditionLabel: null,
  priceMin: null,
  priceMax: null,
  keyword: '',
};

// ---------- 上下文裁剪 ----------

const MAX_HISTORY_MESSAGES = 6;
const MAX_HISTORY_CHARS = 4000;
const MAX_HISTORY_ITEM_CHARS = 300;
const SUMMARY_CHARS = 200;

// 滑动窗口 + 摘要式压缩。
// 直接 slice(-10) 会拆散对话、并且因为把长文本整段带上而撑爆 token，
// 所以这里既限条数、又限总字符，并把更早的内容压成一句话。
export const compactHistory = (
  history: ChatHistoryMessage[],
): { messages: ChatHistoryMessage[]; summary: string | null } => {
  const cleaned = history
    .filter((item) => item.content.trim())
    .map((item) => ({
      role: item.role,
      content: item.content.trim().slice(0, MAX_HISTORY_ITEM_CHARS),
    }));

  const overflow = Math.max(0, cleaned.length - MAX_HISTORY_MESSAGES);
  const dropped = cleaned.slice(0, overflow);
  const recent = cleaned.slice(overflow);

  // 只保留用户说过什么（助手的措辞没必要回放，省 token）
  const summary = dropped.length
    ? `更早的对话摘要：${dropped
        .filter((item) => item.role === 'user')
        .map((item) => item.content)
        .join('；')
        .slice(0, SUMMARY_CHARS)}`
    : null;

  // 字符上限兜底：从最近往更早留
  const kept: ChatHistoryMessage[] = [];
  let used = 0;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const item = recent[index];
    if (used + item.content.length > MAX_HISTORY_CHARS) break;
    used += item.content.length;
    kept.unshift(item);
  }

  return { messages: kept, summary };
};

// ---------- 追问与意图识别（规则实现，离线也能用） ----------

const FOLLOW_UP_PATTERN = /还有|其他|别的|再推荐|换一批|再来|更多/;

// 针对「用户当前关注的商品」的细节类提问。命中这些就不必重新检索。
type FocusIntent = 'images' | 'condition' | 'seller' | 'bargain' | 'price';

const FOCUS_INTENTS: readonly { intent: FocusIntent; pattern: RegExp }[] = [
  // 顺序敏感：议价放在价格前面，否则「能便宜点吗」「太贵了」会被当成普通价格询问。
  // 「太贵|贵了|降价」必须写在 bargain 里 —— 用户说「太贵了」的真实诉求是「找更便宜的」，
  // 若归到 price 只会回一句「这件多少钱」，解决不了他的问题。
  { intent: 'bargain', pattern: /议价|砍价|还价|便宜|少点|优惠|打折|抹零|太贵|贵了|降价|砍一点/ },
  { intent: 'images', pattern: /图片|照片|实拍|大图/ },
  { intent: 'condition', pattern: /成色|新旧|几成|磨损|划痕|瑕疵/ },
  { intent: 'seller', pattern: /卖家|还卖|信誉|信用/ },
  // 「多少钱/什么价」是最常见的问法，早期只写了「贵|价格」，导致「这个多少钱」完全不命中
  { intent: 'price', pattern: /贵|划算|值不值|价格|多少钱|什么价|售价/ },
];

const detectFocusIntent = (message: string): FocusIntent | null =>
  FOCUS_INTENTS.find((item) => item.pattern.test(message))?.intent ?? null;

// ---------- 寒暄 / 售后：不查库的短路话术 ----------
//
// 这两类输入没有任何商品条件，丢进检索管道只会得到「没有找到符合条件的商品」，
// 用户会觉得助手完全听不懂人话。所以命中就直接回话术，连条件解析都跳过。
//
// 注意：AI_MOCK 下这几乎是评委唯一会听到的「AI 说的话」，
// 因此文案按「口语 + 引导 + 可直接点的例子」来写，避免机械句式。
interface CannedReply {
  thought: string;
  reply: string;
  suggestions: string[];
}

// 寒暄必须**整句**匹配：「你好，有没有苹果手机」这种带需求的句子不能被吞掉
const GREETING_PATTERN =
  /^(你好|您好|hi|hello|哈喽|哈啰|嗨|在吗|在不在|有人吗|在么)[\s!！?？。.~～、,，]*$/i;

// 售后类关键词。命中即给流程指引 —— 不能假装能替用户退款
const AFTER_SALES_PATTERN = /退货|退款|售后|换货|保修|投诉|客服/;

const detectCannedReply = (message: string): CannedReply | null => {
  const text = message.trim();

  if (GREETING_PATTERN.test(text)) {
    return {
      thought: '先打个招呼，不用查商品',
      reply:
        '你好呀，我是你的 AI 导购助手。你直接说人话就行，' +
        '比如「两千以内的游戏本」「九成新的 iPhone」，我从在售商品里帮你挑几件合适的。',
      suggestions: ['2000 以内的游戏本', '九成新的 iPhone 13', '无线鼠标'],
    };
  }

  if (AFTER_SALES_PATTERN.test(text)) {
    return {
      thought: '这是售后问题，需要走订单流程',
      reply:
        '退款、退货这些得在订单里操作，我这边只负责帮你挑商品～\n' +
        '路径是：我的订单 → 找到那笔订单 → 申请退款/退货，卖家不处理的话平台会介入。\n' +
        '如果是还没下单、想先看看别的，告诉我预算和想要的类型就行。',
      suggestions: ['2000 以内的游戏本', '九成新的 iPhone 13'],
    };
  }

  return null;
};

// 追问时以上一轮条件为底，再用本轮新解析出的条件覆盖非空字段
const mergeFilters = (previous: ParsedFilters, fresh: ParsedFilters): ParsedFilters => {
  // 追问句的"关键词"往往只是残句（如「还有别 推荐」），不能拿它覆盖上一轮真正想找的东西。
  // 只有用户明确给出了新的结构化条件（分类/成色/价格）时，才认为关键词也换了。
  const freshGivesNewConditions = Boolean(
    fresh.category ||
      fresh.condition ||
      fresh.priceMin !== null ||
      fresh.priceMax !== null,
  );

  return {
    category: fresh.category ?? previous.category,
    condition: fresh.condition ?? previous.condition,
    conditionLabel: fresh.conditionLabel ?? previous.conditionLabel,
    priceMin: fresh.priceMin ?? previous.priceMin,
    priceMax: fresh.priceMax ?? previous.priceMax,
    keyword: freshGivesNewConditions ? fresh.keyword || previous.keyword : previous.keyword,
  };
};

// 把条件渲染成中文，既用于「思考过程」展示，也注入提示词
const describeConditions = (filters: ParsedFilters): string[] => {
  const parts: string[] = [];
  if (filters.category) parts.push(`分类=${filters.category.name}`);
  if (filters.conditionLabel) parts.push(`成色=${filters.conditionLabel}`);
  else if (filters.condition) parts.push(`成色=${CONDITION_LABELS[filters.condition]}`);
  if (filters.priceMin !== null) parts.push(`价格≥${filters.priceMin}`);
  if (filters.priceMax !== null) parts.push(`价格≤${filters.priceMax}`);
  // 只展示「真正参与检索」的关键词：像「还有别 推荐」这种残句会被检索层丢弃，
  // 若仍然展示出来，用户会看到「已识别条件：关键词=还有别 推荐」这种莫名其妙的内容
  if (filters.keyword && expandKeywordVariants(filters.keyword, filters.category?.name ?? null).length > 0) {
    parts.push(`关键词=${filters.keyword}`);
  }
  return parts;
};

// images 在 Prisma 里是 Json 字段，取长度前必须先做类型收窄
const imageCountOf = (product: ProductDTO): number =>
  Array.isArray(product.images) ? product.images.length : 0;

const toBrief = (product: ProductDTO, priceCompare?: string | null): ReplyProductBrief => ({  title: product.title,
  price: product.price,
  conditionLabel: CONDITION_LABELS[product.condition],
  categoryName: product.category.name,
  imageCount: imageCountOf(product),
  sellerNickname: product.seller.nickname ?? product.seller.username,
  ...(priceCompare ? { priceCompare } : {}),
});

// ---------- 本地话术（mock 与降级共用，保证断网时回答依然完整） ----------

const composeLocalReply = (context: ReplyContext, focusAnswer: string | null): string => {
  if (focusAnswer && context.focusProduct) {
    return `关于「${context.focusProduct.title}」：${focusAnswer}`;
  }

  if (context.products.length === 0) {
    const parts = ['没有找到符合条件的商品。'];
    parts.push('可以试试放宽价格区间，或者换一个关键词。');
    return parts.join('');
  }

  const parts: string[] = [];
  if (context.relaxedNote) parts.push(`${context.relaxedNote}。`);
  const best = context.products[0];
  parts.push(
    `为你找到 ${context.total} 件商品，其中「${best.title}」售价 ¥${best.price}、成色${best.conditionLabel}，比较符合你的需求。`,
  );
  if (context.products.length > 1) {
    parts.push(`另外还有 ${context.products.length - 1} 件可选，可以点开卡片看详情。`);
  }
  if (context.weak) {
    parts.push('符合度不算高，如果愿意放宽条件我可以再帮你找找。');
  }
  return parts.join('');
};

// ---------- 推荐词：后端白名单，不让模型自由生成 ----------
//
// 每条建议都必须是平台「答得出来」的，否则用户一点就会得到幻觉回答。
const buildSuggestions = (state: { hasFocus: boolean; total: number; weak: boolean }): string[] => {
  if (state.hasFocus) {
    return ['这件成色怎么样', '有几张实拍图', '卖家还卖什么', '还有别的推荐吗'];
  }
  if (state.total === 0) {
    return ['3000 以内都行', '换成手机数码看看', '只看全新的'];
  }
  if (state.weak) {
    return ['3000 以内都行', '换成手机数码看看', '还有别的推荐吗'];
  }
  return ['还有别的推荐吗', '1500 以内的', '只看九成新以上的'];
};

// 议价场景的正文话术。
// 不能走 composeLocalReply 的「关于「标题」：…」句式 —— 那会把回答缩成一句话，
// 而这里的结果是一批更便宜的商品，需要说清「为什么换一批」以及最便宜的是哪件。
const composeBargainReply = (
  focusProduct: ProductDTO,
  candidates: ProductDTO[],
  budget: number,
  widened: boolean,
): string => {
  const current = Number(focusProduct.price).toFixed(2);
  const head = `这件「${focusProduct.title}」标价 ¥${current}，平台不支持议价，都按标价直接下单。`;

  if (candidates.length === 0) {
    return `${head}同类里暂时没有 ¥${budget} 以内的，要不要换个分类，或者把成色要求放宽一点？`;
  }

  // 结果按热度排序，最便宜的不一定排在第一，这里显式取最低价
  const cheapest = candidates.reduce((min, item) =>
    Number(item.price) < Number(min.price) ? item : min,
  );
  const where = widened
    ? '同类里没找到更便宜的，我在其他分类里挑了几件'
    : `${focusProduct.category.name}里这几件更便宜`;

  return (
    `${head}${where}，都在 ¥${budget} 以内，` +
    `最低的是「${cheapest.title}」¥${Number(cheapest.price).toFixed(2)}，你看看合不合适。`
  );
};

// ---------- 模型流式调用 ----------

interface StreamChunkBody {
  choices?: { delta?: { content?: unknown } }[];
}

// 逐 token 消费 OpenAI 兼容的 SSE 流。
// 前端用 fetch + ReadableStream 收事件；这里是后端消费上游模型的流。
const callDeepSeekStream = async (
  system: string,
  history: ChatHistoryMessage[],
  userBlock: string,
  onDelta: (text: string) => void,
  clientSignal: AbortSignal,
): Promise<void> => {
  const url = env.DEEPSEEK_API_URL;
  if (!url) throw new Error('未配置 DEEPSEEK_API_URL');

  // 客户端断开时要连上游一起掐断，否则还在为 token 付费
  const controller = new AbortController();
  const relay = (): void => controller.abort();
  clientSignal.addEventListener('abort', relay, { once: true });

  let firstTokenTimer: ReturnType<typeof setTimeout> | null = setTimeout(
    () => controller.abort(),
    env.AI_FIRST_TOKEN_TIMEOUT_MS,
  );
  const overallTimer = setTimeout(() => controller.abort(), env.AI_CHAT_TIMEOUT_MS);
  let sawFirstToken = false;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.DEEPSEEK_API_KEY ?? ''}`,
      },
      body: JSON.stringify({
        model: env.DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: system },
          ...history.map((item) => ({ role: item.role, content: item.content })),
          { role: 'user', content: userBlock },
        ],
        temperature: 0.3,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`模型接口返回 HTTP ${response.status}`);
    if (!response.body) throw new Error('模型响应没有可读流');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // 最后一段可能是半行，留到下一轮再拼
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        let parsed: StreamChunkBody;
        try {
          parsed = JSON.parse(payload) as StreamChunkBody;
        } catch {
          continue; // 单个分片坏掉就跳过，不影响整段回答
        }

        const delta = parsed.choices?.[0]?.delta?.content;
        if (typeof delta !== 'string' || !delta) continue;

        if (!sawFirstToken) {
          sawFirstToken = true;
          if (firstTokenTimer) {
            clearTimeout(firstTokenTimer);
            firstTokenTimer = null;
          }
        }
        onDelta(delta);
      }
    }
  } catch (error) {
    // 客户端主动断开：原样抛出，交给上层静默处理，不要写任何事件
    if (clientSignal.aborted) throw error;
    const isTimeout =
      error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
    throw new Error(
      isTimeout
        ? `模型响应超时（首字 ${env.AI_FIRST_TOKEN_TIMEOUT_MS}ms / 整体 ${env.AI_CHAT_TIMEOUT_MS}ms）`
        : error instanceof Error
          ? error.message
          : String(error),
    );
  } finally {
    if (firstTokenTimer) clearTimeout(firstTokenTimer);
    clearTimeout(overallTimer);
    clientSignal.removeEventListener('abort', relay);
  }
};

// 本地话术的分片推送：
// mock / 降级模式下没有模型流，若一次性把整段话写出去，前端就是"啪"地全出现，没有打字感。
// 这里按小片段推送并留出间隔，让观感接近真实流式输出。
const LOCAL_REPLY_CHUNK = 8;
const LOCAL_REPLY_GAP_MS = 60;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const emitLocalReply = async (reply: string, sink: ChatSink, signal: AbortSignal): Promise<void> => {
  const text = reply.trim();
  for (let index = 0; index < text.length; index += LOCAL_REPLY_CHUNK) {
    if (signal.aborted) return;
    sink.delta(text.slice(index, index + LOCAL_REPLY_CHUNK));
    if (index + LOCAL_REPLY_CHUNK < text.length) await sleep(LOCAL_REPLY_GAP_MS);
  }
};

const streamReply = async (
  context: ReplyContext,
  history: ChatHistoryMessage[],
  sink: ChatSink,
  signal: AbortSignal,
  // 议价等场景需要比 composeLocalReply 更完整的正文，由调用方直接给出
  localReplyOverride?: string | null,
): Promise<{ source: ParseSource; degraded: string | null }> => {
  const localReply = localReplyOverride ?? composeLocalReply(context, context.localFact ?? null);

  if (env.AI_MOCK) {
    await emitLocalReply(localReply, sink, signal);
    return { source: 'mock', degraded: '当前为本地规则模式（AI_MOCK=true），回答由本地话术生成' };
  }
  if (!env.DEEPSEEK_API_KEY) {
    await emitLocalReply(localReply, sink, signal);
    return { source: 'mock', degraded: '未配置 DEEPSEEK_API_KEY，回答由本地话术生成' };
  }

  let emitted = '';
  try {
    sink.thought('正在整理回答…');
    await callDeepSeekStream(
      AI_REPLY_SYSTEM_PROMPT,
      history,
      buildReplyUserBlock(context),
      (text) => {
        emitted += text;
        sink.delta(text);
      },
      signal,
    );
    return { source: 'ai', degraded: null };
  } catch (error) {
    // 客户端断开：不要补话术，也不要把错误当成降级
    if (signal.aborted) throw error;

    const reason = error instanceof Error ? error.message : String(error);
    // 已经吐了一部分内容时不再补本地话术，否则会出现两段重复回答
    if (!emitted) await emitLocalReply(localReply, sink, signal);
    return {
      source: 'fallback',
      degraded: `AI 回答不可用，已使用本地话术（${reason}）`,
    };
  }
};

// ---------- 主管线 ----------

export const runChat = async (
  input: ChatInput,
  sink: ChatSink,
  signal: AbortSignal,
): Promise<ChatOutcome> => {
  const startedAt = Date.now();
  const message = input.message.trim();
  const context = input.context ?? {};
  const excludeIds = context.excludeProductIds ?? [];

  // ⓪ 寒暄 / 售后：不查库、不解析条件，直接回话术。
  // 刻意**不发 products 事件** —— 前端会用它的 parsed 覆盖上一轮筛选条件，
  // 发一个空 products 会把「刚才搜过的条件」弄丢。
  const canned = detectCannedReply(message);
  if (canned) {
    sink.thought(canned.thought);
    await emitLocalReply(canned.reply, sink, signal);
    sink.suggestions(canned.suggestions);
    return {
      parseSource: null,
      replySource: 'mock',
      degraded: null,
      elapsedMs: Date.now() - startedAt,
      total: 0,
    };
  }

  // 先判定「是不是在追问当前关注的商品」。
  // 这类问题（成色 / 图片 / 比价 / 议价 / 卖家）不需要解析条件，
  // 因此可以完全跳过条件解析，省掉一次模型调用。
  const focusProduct = context.focusProductId
    ? await findProductById(context.focusProductId)
    : null;
  const focusIntent = focusProduct ? detectFocusIntent(message) : null;

  // ① 解析条件
  sink.thought(focusIntent ? '正在读取你关注的商品…' : '正在理解你的需求…');

  let filters: ParsedFilters;
  let parseSource: ParseSource | null = null;
  let parseNote: string | null = null;
  let conditions: string[] = [];

  if (focusIntent) {
    // 细节类提问沿用上一轮条件即可，没有就用空条件
    filters = context.previousFilters ?? EMPTY_FILTERS;
  } else {
    const isFollowUp = FOLLOW_UP_PATTERN.test(message);
    // 追问句用本地规则解析就够了（「1500 以内的」「换成手机」都能识别），
    // 省掉一次模型调用，也避免因为句子里没有商品词而白白降级
    const fresh = await parseQuery(message, { preferLocal: isFollowUp });
    parseSource = fresh.source;
    parseNote = fresh.note;

    const baseFilters =
      isFollowUp && context.previousFilters
        ? mergeFilters(context.previousFilters, fresh.filters)
        : fresh.filters;
    filters =
      isEmptyFilters(baseFilters) && context.previousFilters
        ? context.previousFilters
        : baseFilters;

    conditions = describeConditions(filters);
    sink.thought(
      conditions.length
        ? `已识别条件：${conditions.join('，')}`
        : '没有识别出明确条件，先按关键词模糊匹配',
    );
  }

  // ② 检索
  let items: ProductDTO[] = [];
  let total = 0;
  let weak = false;
  let relaxedNote: string | null = null;
  // 「卖家还卖什么」时需要知道除了关注商品之外还有几件
  let sellerOtherCount = 0;
  // 议价时算出的价格上限，以及是否已从「同分类」放宽到「全部分类」
  let bargainBudget: number | null = null;
  let bargainWidened = false;

  if (focusIntent && focusProduct) {
    if (focusIntent === 'seller') {
      sink.thought('正在查看这位卖家的其他在售商品…');
      const others = await listSellerOtherProducts(
        focusProduct.sellerId,
        focusProduct.id,
        CHAT_PRODUCT_LIMIT - 1,
      );
      sellerOtherCount = others.length;
      // 把正在讨论的商品一起带上，聊天窗里就能看到它，不用回页面翻
      items = [focusProduct, ...others];
    } else if (focusIntent === 'bargain') {
      // 用户说「太贵了 / 有便宜点的吗」，真实诉求是「找更便宜的」，
      // 所以不能只回一句「不支持议价」把话题堵死。
      //
      // 上限取当前价的 80%：二手价格跨度很大（150 元电饭煲到 4000 元笔记本），
      // 固定减额会让低价商品变成负数，比例更稳。
      const currentPrice = Number(focusProduct.price);
      bargainBudget = Math.max(1, Math.floor(currentPrice * 0.8));
      sink.thought(`正在找 ¥${bargainBudget} 以内的同类商品…`);

      // 当前商品本身也要排除：它是「被嫌贵的那件」，不该出现在更便宜的结果里
      const skipIds = [...new Set([focusProduct.id, ...excludeIds])];
      // 两轮都必须带 priceMax。这里刻意不用 searchWithRelaxation ——
      // 它的放宽阶梯会丢掉价格条件，那样就可能又推出比当前更贵的商品。
      let cheaper = await searchProductsRanked({
        categoryId: focusProduct.categoryId,
        priceMax: bargainBudget,
        keyword: '',
        keywords: [],
        excludeIds: skipIds,
        page: 1,
        pageSize: CHAT_PRODUCT_LIMIT,
      });
      if (cheaper.total === 0) {
        bargainWidened = true;
        cheaper = await searchProductsRanked({
          priceMax: bargainBudget,
          keyword: '',
          keywords: [],
          excludeIds: skipIds,
          page: 1,
          pageSize: CHAT_PRODUCT_LIMIT,
        });
      }
      items = cheaper.list;
      total = cheaper.total;
      weak = cheaper.weak;
      sink.thought(total > 0 ? `找到 ${total} 件更便宜的` : '同类里没有更便宜的');
    } else {
      sink.thought('正在读取这件商品的详细信息…');
      items = [focusProduct];
    }
    total = items.length;
  } else {
    sink.thought('正在商品库中按相关性检索…');
    // 与 /api/ai/search 保持同一套规则：只有条件全空时才用原句当关键词，
    // 否则「2000 以内」这种纯价格查询会被整句话当成关键词而 0 命中
    const rawKeyword = isEmptyFilters(filters) ? message : filters.keyword;
    const keywords = expandKeywordVariants(rawKeyword, filters.category?.name ?? null);
    const result = await searchWithRelaxation({
      filters,
      keyword: keywords.length > 0 ? rawKeyword : '',
      keywords,
      page: 1,
      pageSize: CHAT_PRODUCT_LIMIT,
      excludeIds,
    });
    items = result.list;
    total = result.total;
    weak = result.weak;
    relaxedNote = result.relaxedNote;
    // 放宽条件这件事必须让用户看到。除了写进提示词，这里再推一条思考步骤，
    // 以及 products 事件里的 relaxedNote —— 不依赖模型"自觉"说明。
    if (relaxedNote) sink.thought(relaxedNote);
    sink.thought(total > 0 ? `命中 ${total} 件，已按相关性排序` : '没有命中任何商品');
  }

  // 关注商品的比价结论（真实聚合查询，不是模型编的）
  let priceCompare: string | null = null;
  if (focusProduct) {
    const average = await averagePriceOfCategory(focusProduct.categoryId, focusProduct.id);
    if (average !== null && average > 0) {
      const price = Number(focusProduct.price);
      const diffPercent = ((price - average) / average) * 100;
      const relation =
        Math.abs(diffPercent) < 5
          ? '与同类均价基本持平'
          : diffPercent > 0
            ? `高于同类均价约 ${diffPercent.toFixed(0)}%`
            : `低于同类均价约 ${Math.abs(diffPercent).toFixed(0)}%`;
      priceCompare = `同类在售商品均价 ¥${average.toFixed(2)}，本件${relation}`;
    }
  }

  sink.products({ items, total, weak, relaxedNote, parsed: filters });

  // 针对细节提问给出「事实句」，模型与本地话术共用，避免各说一套
  let localFact: string | null = null;
  if (focusProduct && focusIntent) {
    switch (focusIntent) {
      case 'condition':
        localFact = `这件商品的成色是「${CONDITION_LABELS[focusProduct.condition]}」。具体划痕或磨损程度请以详情页实拍图为准。`;
        break;
      case 'images':
        localFact = `这件商品有 ${imageCountOf(focusProduct)} 张实拍图，可以在商品详情页查看大图。`;
        break;
      case 'bargain':
        localFact = bargainBudget
          ? items.length > 0
            ? `这件商品标价 ¥${Number(focusProduct.price).toFixed(2)}，平台不支持议价；` +
              `已为用户找到 ${items.length} 件 ¥${bargainBudget} 以内的更便宜商品，列表就在下方。`
            : `这件商品标价 ¥${Number(focusProduct.price).toFixed(2)}，平台不支持议价；` +
              `同类里暂时没有 ¥${bargainBudget} 以内的商品，建议换个分类或放宽成色要求。`
          : '平台目前不支持议价，商品都按标价直接下单。';
        break;
      case 'price':
        localFact = priceCompare ? `${priceCompare}。` : '暂时没有足够的同类商品可以用来比价。';
        break;
      case 'seller':
        localFact = sellerOtherCount
          ? `这位卖家还有其他 ${sellerOtherCount} 件在售商品，可以在下面查看。`
          : '这位卖家目前没有其他在售商品。';
        break;
      default:
        break;
    }
  }

  const { messages: history, summary } = compactHistory(input.history ?? []);

  const replyContext: ReplyContext = {
    message,
    conditions,
    products: items.slice(0, PROMPT_PRODUCT_LIMIT).map((item) => toBrief(item)),
    total,
    weak,
    relaxedNote,
    focusProduct: focusProduct ? toBrief(focusProduct, priceCompare) : null,
    historySummary: summary,
    ...(localFact ? { localFact } : {}),
  };

  // ③ 生成回答
  // 议价要讲清「为什么换一批 + 最便宜是哪件」，用专门的话术，不走通用模板
  const bargainReply =
    focusIntent === 'bargain' && focusProduct && bargainBudget !== null
      ? composeBargainReply(focusProduct, items, bargainBudget, bargainWidened)
      : null;
  const reply = await streamReply(replyContext, history, sink, signal, bargainReply);

  sink.suggestions(buildSuggestions({ hasFocus: Boolean(focusIntent), total, weak }));

  // 条件解析与回答生成各自的降级原因合并成一个字段，前端只需展示一处
  const degraded = [parseNote, reply.degraded].filter(Boolean).join('；');

  return {
    parseSource,
    replySource: reply.source,
    degraded: degraded || null,
    elapsedMs: Date.now() - startedAt,
    total,
  };
};
