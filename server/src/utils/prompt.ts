// DeepSeek 提示词：把中文自然语言需求转成一条 JSON 查询条件
//
// 设计要点：
//   1) 只让模型输出 JSON，禁止解释文字与 Markdown 围栏，降低解析成本
//   2) 把「真实分类列表」注入提示词，让模型自己归类，避免它臆造「游戏本」这类不存在的分类
//   3) 成色要求原样保留中文说法，由后端映射表转成枚举（模型不必知道枚举名）
//   4) 给少量示例（few-shot）显著提高字段抽取的稳定性

// 模型应当返回的原始结构：全部字段都可能缺失或类型错乱，一律在 service 层清洗
export interface AiRawFilters {
  category?: unknown;
  condition?: unknown;
  priceMin?: unknown;
  priceMax?: unknown;
  keyword?: unknown;
}

// 占位符：由 buildSearchPrompt 替换成真实分类列表
const CATEGORY_PLACEHOLDER = '{categoryList}';

const PROMPT_TEMPLATE = `你是二手交易平台的搜索条件解析器。你的唯一任务是把用户的中文自然语言需求，转换成一条 JSON 查询条件。

严格要求：
1. 只输出一个 JSON 对象，不要输出任何解释文字，不要使用 Markdown 代码围栏。
2. 五个字段必须全部出现；没有把握的字段用 null，keyword 用空字符串 ""。

字段说明：
- category：商品分类。必须从下面给定的分类列表中挑一个「name」原样返回；都不合适时返回 null。
- condition：成色要求。用中文口语原样保留用户的说法（例如 "九成新"、"全新"、"八成新"）。用户没提成色时返回 null。
- priceMin：价格下限，只要数字，不要货币符号。没提返回 null。
- priceMax：价格上限，只要数字，不要货币符号。没提返回 null。
- keyword：具体的品牌、型号或产品词（例如 "游戏本"、"iPhone 13"、"自行车"）。没有则返回 ""。

价格写法换算：
- "2000以内" / "不超过2000" / "最多2000" → priceMax=2000
- "2000以上" / "2000起" / "至少2000" → priceMin=2000
- "1000到2000" → priceMin=1000 且 priceMax=2000

注意事项：
- 不要臆造分类。分类列表里没有对应词时，category 返回 null，并把该词放进 keyword。
- keyword 里不要再包含价格、成色等已经填进其它字段的信息。

可选商品分类列表：
${CATEGORY_PLACEHOLDER}

示例：
输入：九成新2000以内的游戏本
输出：{"category":"电脑办公","condition":"九成新","priceMin":null,"priceMax":2000,"keyword":"游戏本"}

输入：求购二手自行车
输出：{"category":null,"condition":null,"priceMin":null,"priceMax":null,"keyword":"自行车"}

输入：全新未拆封的 iPhone 13，预算 6000
输出：{"category":"手机数码","condition":"全新未拆封","priceMin":null,"priceMax":6000,"keyword":"iPhone 13"}

输入：无线鼠标 1000 以内
输出：{"category":"电脑办公","condition":null,"priceMin":null,"priceMax":1000,"keyword":"无线鼠标"}`;

// 生成系统提示词：把真实分类列表拼进去（没有分类时退化为空列表提示）
export const buildSearchPrompt = (categories: readonly { name: string; slug?: string }[]): string => {
  const categoryList = categories.length
    ? categories
        .map((item) => (item.slug ? `- ${item.name}（${item.slug}）` : `- ${item.name}`))
        .join('\n')
    : '- （当前平台暂无可用分类）';
  return PROMPT_TEMPLATE.replace(CATEGORY_PLACEHOLDER, categoryList);
};
