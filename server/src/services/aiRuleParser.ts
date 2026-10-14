// 本地规则解析器：不联网、不消耗 API 额度
//
// 两个用途：
//   1) mock 模式：AI_MOCK=true 或未配置 DEEPSEEK_API_KEY 时使用，保证断网也能演示
//   2) 降级路径：真实模型调用超时 / 报错 / 返回内容无法解析时兜底
//
// 只做「中文口语 → 结构化条件」的浅层抽取，够用即可，不追求覆盖所有表述。

import type { ProductCondition } from '@prisma/client';
import type { AiRawFilters } from '../utils/prompt';

export const CONDITIONS: readonly ProductCondition[] = ['NEW', 'LIKE_NEW', 'GOOD', 'FAIR'];

// 成色枚举的默认中文名（用户没给具体说法时用于前端展示）
export const CONDITION_LABELS: Record<ProductCondition, string> = {
  NEW: '全新',
  LIKE_NEW: '几乎全新',
  GOOD: '轻微使用痕迹',
  FAIR: '明显使用痕迹',
};

// 中文成色说法 → 枚举。顺序敏感：更具体的说法必须排在更宽泛的前面，
// 否则「全新未拆封」会被「全新」先命中，「几乎全新」会被「全新」先命中。
const CONDITION_ALIASES: readonly (readonly [ProductCondition, readonly string[]])[] = [
  ['NEW', ['全新未拆封', '全新未使用', '未拆封', '全新', 'brandnew']],
  ['LIKE_NEW', ['几乎全新', '准新', '仅拆封', '拆封未用', '99新', '98新', '95新', '九成新', '9成新']],
  ['GOOD', ['八成新', '8成新', '七成新', '7成新', '轻微使用痕迹']],
  ['FAIR', ['六成新', '6成新', '五成新', '5成新', '明显使用痕迹', '有瑕疵', '磨损明显']],
];

// 分类同义词：值为「分类 name」，用于把口语词归到真实分类上
const CATEGORY_SYNONYMS: Record<string, readonly string[]> = {
  手机数码: ['手机', '数码', '平板', '耳机', '相机', '手表', 'iphone', '安卓', '手机数码'],
  电脑办公: ['游戏本', '笔记本', '电脑', '台式机', '显示器', '键盘', '鼠标', '办公', '电脑办公'],
  家用电器: ['家电', '电器', '吸尘器', '电饭煲', '冰箱', '洗衣机', '空调', '破壁机', '微波炉', '家用电器'],
};

// 需要从关键词里剥掉的噪声词（求购意向、数量词、语气词等）
const NOISE_WORDS: readonly string[] = [
  '求购',
  '收购',
  '想买',
  '想收',
  '我想',
  '我要',
  '我需要',
  '需要',
  '有没有',
  '有卖的',
  '有人卖',
  '二手',
  '闲置',
  '转手',
  '一个',
  '一台',
  '一件',
  '一部',
  '请问',
  '帮我',
  '预算',
  '便宜点',
  '便宜',
  '划算',
  '求',
  '的',
  '吗',
  '呢',
  '啊',
];

const CN_DIGITS: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

// 中文数字或阿拉伯数字 → 数字（仅支持 1~10 的单字中文数字）
const toNumeric = (text: string): number | null => {
  if (/^\d+$/.test(text)) return Number(text);
  return CN_DIGITS[text] ?? null;
};

// 成色文本 → 枚举；识别不了返回 null（调用方会丢弃该字段）
export const matchCondition = (text: string): ProductCondition | null => {
  const value = text.trim();
  if (!value) return null;

  // 模型有时直接返回英文枚举名
  const upper = value.toUpperCase() as ProductCondition;
  if (CONDITIONS.includes(upper)) return upper;

  for (const [condition, aliases] of CONDITION_ALIASES) {
    if (aliases.some((alias) => value.includes(alias))) return condition;
  }

  // 兜底：「N成新」按数字分档
  const matched = /([0-9一二三四五六七八九十]{1,2})\s*成/.exec(value);
  if (matched) {
    const level = toNumeric(matched[1]);
    if (level !== null) {
      if (level >= 9) return 'LIKE_NEW';
      if (level >= 7) return 'GOOD';
      return 'FAIR';
    }
  }

  return null;
};

// 抽取句中命中的成色说法本身（如「九成新」）。
// 返回原文而非枚举，这样前端能展示用户的原始措辞，枚举映射统一交给 service 层。
const matchConditionText = (text: string): string | null => {
  for (const [, aliases] of CONDITION_ALIASES) {
    const hit = aliases.find((alias) => text.includes(alias));
    if (hit) return hit;
  }
  const matched = /[0-9一二三四五六七八九十]{1,2}\s*成(?:新)?/.exec(text);
  return matched ? matched[0].replace(/\s+/g, '') : null;
};

// 价格短语：上限表达
const PRICE_MAX_PATTERNS: readonly RegExp[] = [
  /(\d+(?:\.\d+)?)\s*(?:元|块|rmb)?\s*(?:以内|以下|之内|以里|左右|上下|不超过|最多|封顶)/i,
  /(?:不超过|最多|不高于|预算)\s*(?:在)?\s*(\d+(?:\.\d+)?)/i,
];

// 价格短语：下限表达
const PRICE_MIN_PATTERNS: readonly RegExp[] = [
  /(\d+(?:\.\d+)?)\s*(?:元|块|rmb)?\s*(?:以上|起|往上|起步)/i,
  /(?:至少|不低于|高于|超过)\s*(\d+(?:\.\d+)?)/i,
];

const firstPrice = (text: string, patterns: readonly RegExp[]): number | null => {
  for (const pattern of patterns) {
    const matched = pattern.exec(text);
    if (matched) {
      const value = Number(matched[1]);
      if (Number.isFinite(value) && value >= 0) return Math.round(value * 100) / 100;
    }
  }
  return null;
};

// 从原句中剥掉价格短语，避免它们混进关键词
const PRICE_STRIP_PATTERNS: readonly RegExp[] = [
  /\d+(?:\.\d+)?\s*(?:元|块|rmb)?\s*(?:以内|以下|之内|以里|左右|上下|不超过|最多|封顶|以上|起|往上|起步)/gi,
  /(?:不超过|最多|不高于|预算|至少|不低于|高于|超过)\s*(?:在)?\s*\d+(?:\.\d+)?/gi,
  /[¥￥]/g,
];

// 本地规则解析：返回与模型输出同构的原始结构，后续由 service 层统一清洗
export const parseByRules = (query: string, categoryNames: readonly string[] = []): AiRawFilters => {
  const text = query.trim();

  const priceMax = firstPrice(text, PRICE_MAX_PATTERNS);
  const priceMin = firstPrice(text, PRICE_MIN_PATTERNS);
  // 返回命中的中文说法本身，由 service 层统一映射成枚举
  const condition = matchConditionText(text);

  // 分类：先按真实分类名直接命中，再退到同义词表
  let category: string | null = null;
  const exactName = categoryNames.find((name) => text.includes(name));
  if (exactName) {
    category = exactName;
  } else {
    for (const name of categoryNames) {
      const synonyms = CATEGORY_SYNONYMS[name] ?? [];
      const hit = synonyms.find((word) => text.toLowerCase().includes(word.toLowerCase()));
      if (hit) {
        category = name;
        break;
      }
    }
  }

  // 关键词：剥掉价格短语、成色说法、噪声词后的剩余内容
  // 注意：分类同义词（如「游戏本」）保留在关键词里 —— 它既用于归类，也是真正要搜的产品词
  let keyword = text;
  for (const pattern of PRICE_STRIP_PATTERNS) {
    keyword = keyword.replace(pattern, ' ');
  }
  for (const [, aliases] of CONDITION_ALIASES) {
    for (const alias of aliases) {
      keyword = keyword.split(alias).join(' ');
    }
  }
  if (condition) {
    // 「N成新」这类没进别名表的写法也一并剥掉
    keyword = keyword.split(condition).join(' ');
    keyword = keyword.replace(/[0-9一二三四五六七八九十]{1,2}\s*成(?:新)?/g, ' ');
  }
  for (const word of [...NOISE_WORDS].sort((a, b) => b.length - a.length)) {
    keyword = keyword.split(word).join(' ');
  }
  // 只剥掉完整分类名；同义词（游戏本 / 笔记本）要留给关键词
  for (const name of categoryNames) {
    keyword = keyword.split(name).join(' ');
  }

  keyword = keyword
    .replace(/[，,、。.!！?？:：;；"'“”‘’()（）\[\]【】]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    category,
    condition,
    priceMin,
    priceMax,
    keyword,
  };
};
