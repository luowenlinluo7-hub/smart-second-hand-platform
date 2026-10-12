// AI 自然语言解析：中文需求 → 结构化筛选条件
//
// 三条路径（优先级从高到低）产出同一个 ParsedFilters 结构，因此下游查询逻辑完全一致：
//   ai       真实调用 DeepSeek
//   mock     未配置 Key，或 AI_MOCK=true，走本地规则解析
//   fallback 真实调用超时 / 报错 / 返回内容无法解析，降级到本地规则解析

import type { ProductCondition } from '@prisma/client';
import { z } from 'zod';
import { env } from '../config/env';
import { prisma } from '../utils/prisma';
import { buildSearchPrompt, type AiRawFilters } from '../utils/prompt';
import { CONDITION_LABELS, CONDITIONS, matchCondition, parseByRules } from './aiRuleParser';

export type ParseSource = 'ai' | 'mock' | 'fallback';

// 前端「已识别」标签直接消费这个结构
export interface ParsedFilters {
  category: { id: string; name: string } | null;
  condition: ProductCondition | null;
  conditionLabel: string | null;
  priceMin: number | null;
  priceMax: number | null;
  keyword: string;
}

export interface ParseOutcome {
  filters: ParsedFilters;
  source: ParseSource;
  note: string | null;
}

interface CategoryRef {
  id: string;
  name: string;
}

// 价格上限保护：超过这个数的「价格」几乎肯定是模型抽错了
const MAX_PRICE = 1_000_000_000;
const MAX_KEYWORD_LENGTH = 50;

// ---------- 模型输出的宽松校验 ----------
// 每个字段都允许类型错乱并 .catch(null)：单个字段异常时只丢弃该字段，
// 绝不让整体解析 reject —— 这就是需求里的「异常值丢弃」。
const looseText = z.union([z.string(), z.number(), z.null()]).catch(null);
const looseNumber = z.union([z.number(), z.string(), z.null()]).catch(null);

const rawFiltersSchema = z.object({
  category: looseText.optional(),
  condition: looseText.optional(),
  priceMin: looseNumber.optional(),
  priceMax: looseNumber.optional(),
  keyword: looseText.optional(),
});

// ---------- 字段清洗 ----------

const round2 = (value: number): number => Math.round(value * 100) / 100;

// 价格：接受数字或纯数字字符串，丢弃负数、非数与超大值
const toPrice = (value: unknown): number | null => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || value > MAX_PRICE) return null;
    return round2(value);
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/[,，¥￥\s]/g, '');
    if (!/^\d+(?:\.\d+)?$/.test(cleaned)) return null;
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed) || parsed > MAX_PRICE) return null;
    return round2(parsed);
  }
  return null;
};

const toText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const toKeyword = (value: unknown): string => {
  const text = toText(value);
  if (!text) return '';
  return text.replace(/\s+/g, ' ').slice(0, MAX_KEYWORD_LENGTH).trim();
};

// 分类：先在真实分类里精确匹配，再退到双向包含匹配
const resolveCategory = (value: unknown, categories: CategoryRef[]): CategoryRef | null => {
  const text = toText(value);
  if (!text) return null;

  const exact = categories.find((item) => item.name === text);
  if (exact) return exact;

  // 模型可能返回「电脑办公类」「电脑」这类变体
  const partial = categories.find(
    (item) => text.includes(item.name) || item.name.includes(text),
  );
  return partial ?? null;
};

// 展示用的成色文字：优先保留用户/模型给出的中文说法；
// 若给出的是英文枚举名，则回落成默认中文名，避免前端把 LIKE_NEW 直接显示给用户
const toConditionLabel = (rawText: string, condition: ProductCondition): string => {
  if (CONDITIONS.includes(rawText.toUpperCase() as ProductCondition)) {
    return CONDITION_LABELS[condition];
  }
  return rawText.slice(0, 10) || CONDITION_LABELS[condition];
};

// 把模型原始输出清洗成可信的 ParsedFilters
const sanitize = (raw: AiRawFilters, categories: CategoryRef[]): ParsedFilters => {
  const rawCategoryText = toText(raw.category);
  const category = resolveCategory(raw.category, categories);

  const rawConditionText = toText(raw.condition);
  const condition = rawConditionText ? matchCondition(rawConditionText) : null;
  const conditionLabel = condition ? toConditionLabel(rawConditionText, condition) : null;

  let priceMin = toPrice(raw.priceMin);
  let priceMax = toPrice(raw.priceMax);
  // 模型把上下限写反了：交换而不是丢弃
  if (priceMin !== null && priceMax !== null && priceMax < priceMin) {
    const swapped = priceMin;
    priceMin = priceMax;
    priceMax = swapped;
  }

  let keyword = toKeyword(raw.keyword);
  // 分类文本没能对应到真实分类时，把它并进关键词，避免这条信息被直接丢掉
  if (!category && rawCategoryText && !keyword.includes(rawCategoryText)) {
    keyword = `${keyword} ${rawCategoryText}`.trim().slice(0, MAX_KEYWORD_LENGTH).trim();
  }

  return { category, condition, conditionLabel, priceMin, priceMax, keyword };
};

// 清洗后一个有效条件都没有 → 视为解析失败，走兜底
export const isEmptyFilters = (filters: ParsedFilters): boolean =>
  !filters.category &&
  !filters.condition &&
  filters.priceMin === null &&
  filters.priceMax === null &&
  !filters.keyword;

// ---------- 从模型响应里提取 JSON ----------

// 模型偶尔会带 Markdown 围栏或前后解释文字，这里做健壮提取
export const extractJsonObject = (content: string): unknown => {
  const trimmed = content.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();

  const candidates = [withoutFence];
  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  if (start >= 0 && end > start) {
    candidates.push(withoutFence.slice(start, end + 1));
  }
  if (trimmed !== withoutFence) candidates.push(trimmed);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // 换下一个候选，全部失败才报错
    }
  }
  throw new Error('模型返回内容不是合法 JSON');
};

interface ChatCompletionBody {
  choices?: { message?: { content?: unknown } }[];
}

const readContent = (body: string): string => {
  let parsed: ChatCompletionBody;
  try {
    parsed = JSON.parse(body) as ChatCompletionBody;
  } catch {
    throw new Error('模型响应不是合法 JSON');
  }
  const content = parsed.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('模型响应缺少 content');
  }
  return content;
};

// ---------- 调用 DeepSeek ----------

interface CompletionResult {
  ok: boolean;
  status: number;
  body: string;
}

const buildBody = (
  query: string,
  categories: CategoryRef[],
  withJsonFormat: boolean,
): Record<string, unknown> => ({
  model: env.DEEPSEEK_MODEL,
  messages: [
    { role: 'system', content: buildSearchPrompt(categories) },
    { role: 'user', content: query },
  ],
  temperature: 0,
  // 部分 OpenAI 兼容端点不支持 response_format，故做成可选并在 400 时重试
  ...(withJsonFormat ? { response_format: { type: 'json_object' } } : {}),
});

const requestCompletion = async (
  url: string,
  body: Record<string, unknown>,
): Promise<CompletionResult> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.DEEPSEEK_API_KEY ?? ''}`,
    },
    body: JSON.stringify(body),
    // Node 内置超时信号，无需引入 HTTP 客户端依赖
    signal: AbortSignal.timeout(env.AI_TIMEOUT_MS),
  });
  const text = await response.text();
  return { ok: response.ok, status: response.status, body: text };
};

const callDeepSeek = async (query: string, categories: CategoryRef[]): Promise<AiRawFilters> => {
  const url = env.DEEPSEEK_API_URL;
  if (!url) throw new Error('未配置 DEEPSEEK_API_URL');

  let result: CompletionResult;
  try {
    result = await requestCompletion(url, buildBody(query, categories, true));
    if (!result.ok && result.status === 400) {
      result = await requestCompletion(url, buildBody(query, categories, false));
    }
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new Error(`模型响应超过 ${env.AI_TIMEOUT_MS}ms`);
    }
    throw new Error(error instanceof Error ? error.message : String(error));
  }

  if (!result.ok) {
    throw new Error(`模型接口返回 HTTP ${result.status}`);
  }

  const parsed = rawFiltersSchema.safeParse(extractJsonObject(readContent(result.body)));
  if (!parsed.success) {
    throw new Error('模型输出的 JSON 结构不符合预期');
  }
  return parsed.data;
};

// 读取启用的分类：既用于提示词注入，也用于把模型的分类文本映射成真实分类
const loadCategories = (): Promise<CategoryRef[]> =>
  prisma.category.findMany({
    where: { status: 'ENABLED' },
    select: { id: true, name: true },
    orderBy: { sortOrder: 'asc' },
  });

const MOCK_NOTE = '已使用本地规则解析（不消耗 API 额度）';

export interface ParseOptions {
  // 强制走本地规则解析。用于追问句这类「本地规则已经够用」的场景，
  // 省掉一次模型调用。
  preferLocal?: boolean;
}

// 对外入口：解析一句自然语言，返回筛选条件 + 条件来源
export const parseQuery = async (
  query: string,
  options: ParseOptions = {},
): Promise<ParseOutcome> => {
  const categories = await loadCategories();
  const categoryNames = categories.map((item) => item.name);
  const fromRules = (note: string, source: ParseSource = 'mock'): ParseOutcome => ({
    filters: sanitize(parseByRules(query, categoryNames), categories),
    source,
    note,
  });

  if (options.preferLocal) return fromRules('追问句使用本地规则解析，未调用模型');
  if (env.AI_MOCK) return fromRules(MOCK_NOTE);
  if (!env.DEEPSEEK_API_KEY) return fromRules('未配置 DEEPSEEK_API_KEY，已使用本地规则解析');

  try {
    const filters = sanitize(await callDeepSeek(query, categories), categories);
    if (isEmptyFilters(filters)) throw new Error('模型未能解析出任何有效条件');
    return { filters, source: 'ai', note: null };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return fromRules(`AI 解析不可用，已降级为本地规则解析（${reason}）`, 'fallback');
  }
};
