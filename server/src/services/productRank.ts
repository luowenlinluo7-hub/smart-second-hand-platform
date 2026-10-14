// 关键词相关性打分与排序（纯函数，不碰数据库，便于单独验证）
//
// 解决的问题：原来用 LIKE '%关键词%' + createdAt 倒序，
//   1) 拉丁词会被子串误命中 —— 「ai」命中「Air」
//   2) 结果按时间排，用户感知不到相关性，看起来像随机
//
// 做法：候选集由 Prisma 粗筛，精确性与排序在这里用内存打分完成。
//   - 拉丁词按「整词」匹配（字母数字边界），杜绝 ai → Air
//   - 中文按整段命中 + 2-gram 部分命中，兼顾「游戏本」与「游戏」
//   - 标题命中权重远高于描述
//   - 热度（浏览量/收藏量）只作为同分时的并列打破，不喧宾夺主

import type { Prisma } from '@prisma/client';

// 参与打分的字段。用结构化类型，兼容 Prisma 原始结果与对外的 ProductDTO
export interface RankableProduct {
  title: string;
  description: string | null;
  viewCount: number;
  favoriteCount: number;
  createdAt: Date;
}

export interface RankedProduct<T extends RankableProduct> {
  product: T;
  score: number;
}

export interface KeywordTokens {
  // 完整关键词原文，用于权重最高的「整句命中」
  phrase: string;
  // 拉丁字母 / 数字词（已转小写）
  latin: string[];
  // 连续中文片段（已去重）
  cjk: string[];
  // 中文 2-gram，用于整段没命中时的部分得分
  bigrams: string[];
}

// 各项命中权重：标题 > 描述，整句 > 整词 > 片段
const WEIGHT = {
  phraseInTitle: 20,
  latinInTitle: 12,
  latinInDesc: 4,
  cjkInTitle: 10,
  cjkInDesc: 3,
  bigramInTitle: 2,
} as const;

// 热度上限：只用于打破同分，不能盖过内容相关性的差异
const MAX_HEAT_BONUS = 5;

// 候选集抓取上限。本项目商品量很小，这个值实际等于「全量」；
// 若未来数据量上来，应改为先按相关性在 SQL 侧排序再分页。
export const CANDIDATE_LIMIT = 300;

// 判定「弱结果」的分数阈值：只有单个中文片段命中（10 分）以下就算弱
export const WEAK_SCORE = 10;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 拉丁词整词匹配：用字母数字边界，避免 ai 命中 Air、13 命中 130
const latinWordRegex = (token: string): RegExp =>
  new RegExp(`(?<![a-z0-9])${escapeRegExp(token)}(?![a-z0-9])`, 'i');

// 整句命中判断。
// 纯拉丁/数字短语必须按词边界匹配，否则「ai」会命中「MacBook Air」——
// 这正是改造前最刺眼的问题。含中文的短语用子串匹配即可（中文没有词边界概念）。
const phraseMatches = (title: string, phrase: string): boolean => {
  if (!phrase) return false;
  if (/[\u4e00-\u9fa5]/.test(phrase)) return title.includes(phrase);
  return latinWordRegex(phrase).test(title);
};

// 把关键词拆成可用于打分与粗筛的 token
export const tokenizeKeyword = (keyword: string): KeywordTokens => {
  const phrase = keyword.trim().replace(/\s+/g, ' ');

  const latin = [...new Set([...phrase.matchAll(/[a-z0-9]+/gi)].map((m) => m[0].toLowerCase()))];

  // 中文片段：非中文一律视为分隔符
  const segments = [...new Set(phrase.split(/[^\u4e00-\u9fa5]+/).filter(Boolean))];

  const bigramSet = new Set<string>();
  for (const segment of segments) {
    if (segment.length < 2) {
      bigramSet.add(segment);
      continue;
    }
    for (let i = 0; i < segment.length - 1; i += 1) {
      bigramSet.add(segment.slice(i, i + 2));
    }
  }

  return { phrase, latin, cjk: segments, bigrams: [...bigramSet] };
};

// 内容相关性得分（不含热度）
export const scoreProduct = (product: RankableProduct, tokens: KeywordTokens): number => {
  const title = product.title ?? '';
  const description = product.description ?? '';

  let score = 0;

  // 整句原样命中标题，几乎可以确定是用户想找的东西
  if (phraseMatches(title, tokens.phrase)) {
    score += WEIGHT.phraseInTitle;
  }

  for (const token of tokens.latin) {
    if (latinWordRegex(token).test(title)) {
      score += WEIGHT.latinInTitle;
    } else if (latinWordRegex(token).test(description)) {
      score += WEIGHT.latinInDesc;
    }
  }

  let cjkHitInTitle = false;
  for (const segment of tokens.cjk) {
    if (title.includes(segment)) {
      score += WEIGHT.cjkInTitle;
      cjkHitInTitle = true;
    } else if (description.includes(segment)) {
      score += WEIGHT.cjkInDesc;
    }
  }

  // 中文整段都没命中标题时，用 2-gram 给部分命中一点分，
  // 这样「游戏本」也能捞到标题里只写了「游戏」的商品，但分数明显更低
  if (!cjkHitInTitle && tokens.bigrams.length > 0) {
    const hits = tokens.bigrams.filter((gram) => title.includes(gram)).length;
    if (hits > 0) {
      score += Math.round(((WEIGHT.bigramInTitle * hits) / tokens.bigrams.length) * 10) / 10;
    }
  }

  return score;
};

// 热度加成：浏览量 / 收藏量换算成一个不超过 MAX_HEAT_BONUS 的小数
const heatBonus = (product: RankableProduct): number => {
  const raw = product.viewCount / 100 + product.favoriteCount / 20;
  return Math.min(Math.round(raw * 10) / 10, MAX_HEAT_BONUS);
};

// 打分并排序。返回结果已过滤掉零分项（零分 = 与该关键词无关）
export const rankProducts = <T extends RankableProduct>(
  items: T[],
  keyword: string,
): RankedProduct<T>[] => {
  const tokens = tokenizeKeyword(keyword);

  // 没有关键词时不打分，直接按热度 + 时间给出稳定顺序
  if (!tokens.phrase) {
    return [...items]
      .sort(
        (a, b) =>
          b.viewCount - a.viewCount ||
          b.favoriteCount - a.favoriteCount ||
          b.createdAt.getTime() - a.createdAt.getTime(),
      )
      .map((product) => ({ product, score: 0 }));
  }

  return items
    .map((product) => {
      const base = scoreProduct(product, tokens);
      // 热度只在已经相关的前提下加分，避免把无关商品抬上来
      const score = base > 0 ? Math.round((base + heatBonus(product)) * 10) / 10 : 0;
      return { product, score };
    })
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.product.viewCount - a.product.viewCount ||
        b.product.createdAt.getTime() - a.product.createdAt.getTime(),
    );
};

// 粗筛条件：只要候选里有「可能相关」的行即可，精确性交给打分。
// 拉丁词这里仍用 contains（可能多召回 Air 之类），随后会被打分淘汰。
export const buildCandidateWhere = (keyword: string): Prisma.ProductWhereInput | null => {
  const tokens = tokenizeKeyword(keyword);
  if (!tokens.phrase) return null;

  const needles = [...new Set([...tokens.latin, ...tokens.cjk, ...tokens.bigrams])];
  if (needles.length === 0) return null;

  return {
    OR: needles.flatMap((needle) => [
      { title: { contains: needle } },
      { description: { contains: needle } },
    ]),
  };
};

// 供上层判断是否需要提示「结果较弱」。
// 只看最高分，不看数量 —— 精准命中但只有 2 件，属于好结果而不是弱结果。
export const isWeakResult = (ranked: { score: number }[]): boolean =>
  ranked.length === 0 || ranked[0].score < WEAK_SCORE;
