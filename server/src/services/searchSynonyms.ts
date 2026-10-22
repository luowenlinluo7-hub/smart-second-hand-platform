// 检索层的口语归一化：停用词过滤 + 品牌/品类别名展开
//
// 为什么放在检索层而不是解析层：
//   /api/ai/search 与 /api/ai/chat 共用 searchWithRelaxation，
//   把归一化做在这里，真实 AI 与 AI_MOCK 本地规则两条路径同时受益，
//   不必在模型提示词与规则解析器里各维护一份。
//
// 覆盖范围刻意控制在「本项目商品库实际存在的写法」，
// 不做通用的百科式同义词库 —— 阈值越低误召回越多，二手场景下宁可准一点。

// 求购意向、语气词、数量词：不参与检索
const STOP_WORDS: readonly string[] = [
  '有没有',
  '有无',
  '想买',
  '想收',
  '求购',
  '收购',
  '求推荐',
  '推荐',
  '帮我',
  '帮忙',
  '请问',
  '我想',
  '我要',
  '我需要',
  '需要',
  '找找',
  '找一下',
  '看看',
  '看一下',
  '有什么',
  '有啥',
  '什么',
  '哪些',
  '哪个',
  '都行',
  '都可以',
  '推荐下',
  '推荐一下',
  '一台',
  '一部',
  '一个',
  '一件',
  '的',
  '吗',
  '呢',
  '啊',
  '吧',
  '左右的',
  '左右',
  '以内的',
  '以内',
  '以下的',
  '以下',
  '之内',
  '以里',
];

// 品类所属的「大类」，用于判断品牌该展开成哪些产品词。
// 用户说「苹果手机」要的只有 iPhone，不能把 MacBook 也一起捞出来。
type Scope = 'phone' | 'computer' | 'tablet' | 'earphone' | 'watch';

// 关键词 / 分类名里出现这些词时，判定属于对应大类
const SCOPE_HINTS: Record<Scope, readonly string[]> = {
  phone: ['手机', '电话', '手机数码'],
  computer: ['电脑', '笔记本', '台式', '游戏本', '办公', '电脑办公', '显示器', '键盘', '鼠标'],
  tablet: ['平板', 'ipad'],
  earphone: ['耳机', '耳麦', '耳塞'],
  watch: ['手表', '手环'],
};

// 品牌 → 大类 → 标题里可能出现的写法。all 为该品牌不限大类时的全部写法
const BRAND_ALIASES: Record<string, Partial<Record<Scope | 'all', readonly string[]>>> = {
  苹果: {
    phone: ['iphone'],
    computer: ['macbook', 'imac'],
    tablet: ['ipad'],
    earphone: ['airpods'],
    watch: ['watch'],
    all: ['iphone', 'ipad', 'macbook', 'airpods'],
  },
  华为: {
    phone: ['华为', 'huawei', 'mate'],
    computer: ['华为', 'huawei', 'matebook'],
    tablet: ['huawei', 'matepad'],
    all: ['华为', 'huawei', 'mate', 'matebook'],
  },
  小米: {
    phone: ['小米', 'xiaomi', 'redmi'],
    computer: ['小米', 'xiaomi', 'redmi'],
    tablet: ['小米', 'xiaomi', 'pad'],
    all: ['小米', 'xiaomi', 'redmi'],
  },
  红米: { all: ['redmi', '小米'] },
  联想: { all: ['联想', 'lenovo', 'thinkpad', '拯救者', '小新'] },
  戴尔: { all: ['戴尔', 'dell', '游匣'] },
  华硕: { all: ['华硕', 'asus', '天选'] },
  机械革命: { all: ['机械革命'] },
  索尼: { all: ['索尼', 'sony'] },
  罗技: { all: ['罗技', 'logitech'] },
  戴森: { all: ['戴森', 'dyson'] },
  美的: { all: ['美的'] },
  九阳: { all: ['九阳'] },
  惠普: { all: ['惠普', 'hp'] },
  飞利浦: { all: ['飞利浦', 'philips'] },
  海尔: { all: ['海尔', 'haier'] },
};

// 口语品类 → 标题里的实际写法（与品牌表互补：品类词描述"是什么"，品牌词描述"谁家的"）
const PRODUCT_ALIASES: Record<string, readonly string[]> = {
  降噪耳机: ['airpods', '耳机'],
  无线耳机: ['airpods', '耳机'],
  蓝牙耳机: ['airpods', '耳机'],
  头戴耳机: ['耳机', 'wh-1000'],
  耳机: ['airpods', '耳机'],
  平板电脑: ['ipad', 'pad'],
  平板: ['ipad', 'pad'],
  游戏电脑: ['游戏本'],
  游戏机: ['游戏本'],
  游戏: ['游戏本'],
  笔记本电脑: ['笔记本', '游戏本', 'macbook', 'thinkpad'],
  笔记本: ['笔记本', '游戏本', 'macbook', 'thinkpad'],
  轻薄本: ['轻薄', '游戏本', 'macbook'],
  台式机: ['台式', '主机'],
  吸尘器: ['吸尘器'],
  电饭煲: ['电饭煲'],
  破壁机: ['破壁机'],
  鼠标: ['鼠标'],
  键盘: ['键盘'],
  显示器: ['显示器'],
  洗衣机: ['洗衣机'],
  空调: ['空调'],
  电磁炉: ['电磁炉'],
  牙刷: ['牙刷'],
  打印机: ['打印机'],
};

// 排序时用长词优先，避免「耳机」先于「降噪耳机」命中而漏掉更具体的映射
const NOISE_SORTED = [...STOP_WORDS].sort((a, b) => b.length - a.length);
const PRODUCT_KEYS_SORTED = Object.keys(PRODUCT_ALIASES).sort((a, b) => b.length - a.length);

/** 去掉求购意向、语气词等不参与检索的内容 */
export const stripStopWords = (text: string): string => {
  let result = text;
  for (const word of NOISE_SORTED) {
    result = result.split(word).join(' ');
  }
  return result.replace(/\s+/g, ' ').trim();
};

/** 从关键词与分类名推断商品大类 */
const detectScope = (keyword: string, categoryName: string | null): Scope | null => {
  const pool = `${keyword} ${categoryName ?? ''}`.toLowerCase();
  for (const [scope, hints] of Object.entries(SCOPE_HINTS) as [Scope, readonly string[]][]) {
    if (hints.some((hint) => pool.includes(hint))) return scope;
  }
  return null;
};

/**
 * 把口语关键词展开成多个等价写法，供检索做「任一命中即相关」。
 *
 * 例：
 *   「苹果手机」          → ['苹果手机', 'iphone']
 *   「苹果」 + 分类手机数码 → ['苹果', 'iphone']
 *   「苹果」（无分类）      → ['苹果', 'iphone', 'ipad', 'macbook', 'airpods']
 *   「降噪耳机」          → ['降噪耳机', 'airpods', '耳机']
 *   「游戏电脑」          → ['游戏电脑', '游戏本']
 *   ''                   → []（空关键词不加任何过滤）
 */
export const expandKeywordVariants = (
  keyword: string,
  categoryName: string | null = null,
): string[] => {
  const base = stripStopWords(keyword);
  if (!base) return [];

  const variants = new Set<string>([base]);
  const lower = base.toLowerCase();
  const scope = detectScope(base, categoryName);

  // 品牌展开
  for (const [brand, table] of Object.entries(BRAND_ALIASES)) {
    if (!lower.includes(brand.toLowerCase())) continue;
    const scoped = scope ? table[scope] : undefined;
    const terms = scoped ?? table.all ?? [];
    for (const term of terms) variants.add(term);
  }

  // 品类展开
  for (const key of PRODUCT_KEYS_SORTED) {
    if (!lower.includes(key.toLowerCase())) continue;
    for (const term of PRODUCT_ALIASES[key]) variants.add(term);
    // 命中最长的那个品类词就够了，避免「耳机」再叠一层
    break;
  }

  return [...variants];
};
