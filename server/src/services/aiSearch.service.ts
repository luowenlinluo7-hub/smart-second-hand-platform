// AI 搜索结果编排：把解析出的条件交给 Prisma 查询，并处理「条件过严导致 0 结果」的情况
//
// 放宽策略：严格匹配命中不到时，按阶梯逐步丢弃次要条件。
// 关键词永不丢弃 —— 丢掉它就等于完全不理会用户想买什么。

import { parseQuery, type ParseSource, type ParsedFilters } from './ai.service';
import { listProducts, type ProductListQuery, type ProductListResult } from './product.service';

interface RelaxStep {
  condition: boolean;
  price: boolean;
  category: boolean;
  note: string | null;
}

// 从「全部条件」逐步丢到「只剩关键词」，命中即停
const RELAX_STEPS: readonly RelaxStep[] = [
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

export interface AiSearchResult extends ProductListResult {
  parsed: ParsedFilters;
  relaxed: boolean;
  relaxedNote: string | null;
  source: ParseSource;
  parseNote: string | null;
}

export interface AiSearchInput {
  query: string;
  page: number;
  pageSize: number;
}

// 按阶梯某一步的开关组装查询条件
const buildQuery = (
  filters: ParsedFilters,
  keyword: string,
  step: RelaxStep,
  page: number,
  pageSize: number,
): ProductListQuery => ({
  keyword,
  page,
  pageSize,
  ...(step.category && filters.category ? { categoryId: filters.category.id } : {}),
  ...(step.condition && filters.condition ? { condition: filters.condition } : {}),
  ...(step.price && filters.priceMin !== null ? { priceMin: filters.priceMin } : {}),
  ...(step.price && filters.priceMax !== null ? { priceMax: filters.priceMax } : {}),
});

export const searchByAi = async (input: AiSearchInput): Promise<AiSearchResult> => {
  const outcome = await parseQuery(input.query);
  const { filters } = outcome;

  // 一个条件都没解析出来时，退回用原句当关键词，避免查询条件全空导致返回全量商品
  const keyword = filters.keyword || input.query.trim();

  let strictResult: ProductListResult | null = null;

  for (let index = 0; index < RELAX_STEPS.length; index += 1) {
    const step = RELAX_STEPS[index];
    const result = await listProducts(
      buildQuery(filters, keyword, step, input.page, input.pageSize),
    );

    if (index === 0) strictResult = result;

    if (result.total > 0) {
      return {
        ...result,
        parsed: filters,
        relaxed: index > 0,
        relaxedNote: step.note,
        source: outcome.source,
        parseNote: outcome.note,
      };
    }
  }

  // 六步全空：返回严格条件下的空结果，前端据此提示「未找到相关商品」
  const empty = strictResult ?? { list: [], total: 0, page: input.page, pageSize: input.pageSize };
  return {
    ...empty,
    parsed: filters,
    relaxed: false,
    relaxedNote: null,
    source: outcome.source,
    parseNote: outcome.note,
  };
};
