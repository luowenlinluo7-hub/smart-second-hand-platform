// AI 搜索编排：把解析出的条件交给 Prisma 查询，并处理「条件过严导致 0 结果」的情况
//
// 放宽策略：严格匹配命中不到时，按阶梯逐步丢弃次要条件。
// 关键词永不丢弃 —— 丢掉它就等于完全不理会用户想买什么。
//
// searchWithRelaxation 同时被 /api/ai/search 与 /api/ai/chat 复用，
// 保证两条入口的检索行为完全一致。

import { parseQuery, isEmptyFilters, type ParseSource, type ParsedFilters } from './ai.service';
import { expandKeywordVariants } from './searchSynonyms';
import {
  searchProductsRanked,
  type RankedSearchQuery,
  type RankedSearchResult,
} from './product.service';

export interface RelaxStep {
  condition: boolean;
  price: boolean;
  category: boolean;
  note: string | null;
}

// 从「全部条件」逐步丢到「只剩关键词」，命中即停
export const RELAX_STEPS: readonly RelaxStep[] = [
  { condition: true, price: true, category: true, note: null },
  { condition: false, price: true, category: true, note: '未找到完全匹配，已忽略成色要求' },
  { condition: true, price: false, category: true, note: '未找到完全匹配，已忽略价格区间' },
  { condition: false, price: false, category: true, note: '未找到完全匹配，已忽略成色与价格要求' },
  { condition: true, price: true, category: false, note: '未找到完全匹配，已放宽分类范围' },
  {
    condition: false,
    price: false,
    category: false,
    note: '未找到完全匹配，已忽略成色、价格与分类，仅按关键词匹配',
  },
];

export interface RelaxSearchParams {
  filters: ParsedFilters;
  keyword: string;
  // keyword 的等价写法（品牌别名展开后），为空时退化为 [keyword]
  keywords?: string[];
  page: number;
  pageSize: number;
  excludeIds?: string[];
}

export interface RelaxSearchResult extends RankedSearchResult {
  relaxed: boolean;
  relaxedNote: string | null;
}

// 按阶梯某一步的开关组装查询条件
const buildQuery = (params: RelaxSearchParams, step: RelaxStep): RankedSearchQuery => {
  const { filters, keyword, keywords, page, pageSize, excludeIds } = params;
  return {
    keyword,
    // 即使是空数组也要显式传下去：空数组表示「关键词全是填充词，不参与过滤」，
    // 若省略则 product.service 会回退到 keyword，把无意义的原串当成检索条件
    keywords: keywords ?? [],
    page,
    pageSize,
    ...(excludeIds && excludeIds.length > 0 ? { excludeIds } : {}),
    ...(step.category && filters.category ? { categoryId: filters.category.id } : {}),
    ...(step.condition && filters.condition ? { condition: filters.condition } : {}),
    ...(step.price && filters.priceMin !== null ? { priceMin: filters.priceMin } : {}),
    ...(step.price && filters.priceMax !== null ? { priceMax: filters.priceMax } : {}),
  };
};

// 逐级放宽直到命中；六步全空时返回严格条件下的空结果（不会退化成返回全量商品）
export const searchWithRelaxation = async (
  params: RelaxSearchParams,
): Promise<RelaxSearchResult> => {
  let strict: RankedSearchResult | null = null;

  for (let index = 0; index < RELAX_STEPS.length; index += 1) {
    const step = RELAX_STEPS[index];
    const result = await searchProductsRanked(buildQuery(params, step));

    if (index === 0) strict = result;

    if (result.total > 0) {
      return { ...result, relaxed: index > 0, relaxedNote: step.note };
    }
  }

  const empty = strict ?? {
    list: [],
    total: 0,
    page: params.page,
    pageSize: params.pageSize,
    weak: true,
  };
  return { ...empty, relaxed: false, relaxedNote: null };
};

export interface AiSearchResult extends RelaxSearchResult {
  parsed: ParsedFilters;
  source: ParseSource;
  parseNote: string | null;
}

export interface AiSearchInput {
  query: string;
  page: number;
  pageSize: number;
}

export const searchByAi = async (input: AiSearchInput): Promise<AiSearchResult> => {
  const outcome = await parseQuery(input.query);

  // 只有在「一个条件都没解析出来」时才退回原句当关键词。
  // 早期版本写成 filters.keyword || input.query，导致「两千以内」这类只有价格条件的
  // 查询把整句话当成关键词去匹配标题，必然 0 结果 —— 这是纯条件查询失效的根因。
  const rawKeyword = isEmptyFilters(outcome.filters) ? input.query.trim() : outcome.filters.keyword;
  const keywords = expandKeywordVariants(rawKeyword, outcome.filters.category?.name ?? null);
  // 展开后为空说明关键词全是「有什么」这类填充词，此时不能再用原串兜底，
  // 否则会带着一个无意义的关键词去检索，把条件查询又变成 0 结果
  const keyword = keywords.length > 0 ? rawKeyword : '';

  const result = await searchWithRelaxation({
    filters: outcome.filters,
    keyword,
    keywords,
    page: input.page,
    pageSize: input.pageSize,
  });

  return { ...result, parsed: outcome.filters, source: outcome.source, parseNote: outcome.note };
};
