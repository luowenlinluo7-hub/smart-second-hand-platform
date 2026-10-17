import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/utils/password';

// seed 专用的 PrismaClient：不复用 src/utils/prisma.ts，
// 避免 seed 被 JWT_SECRET 等无关环境变量的校验拦住
const prisma = new PrismaClient();

// ⚠️ 以下为本地开发演示密码，生产环境必须全部更换
const ADMIN_PASSWORD = 'Admin@123456';
const SELLER_PASSWORD = 'Seller@123456';
const USER_PASSWORD = 'User@123456';

// 商品状态统一置为在售，否则前台按 status=ON_SALE 查询将一无所获
type SeedCondition = 'NEW' | 'LIKE_NEW' | 'GOOD' | 'FAIR';

interface SeedProduct {
  id: string;
  title: string;
  description: string;
  price: string;
  originalPrice?: string;
  condition: SeedCondition;
  categoryId: string;
  images: string[];
  viewCount: number;
  favoriteCount: number;
}

const CATEGORY_PHONE = 'seed-cat-phone';
const CATEGORY_COMPUTER = 'seed-cat-computer';
const CATEGORY_APPLIANCE = 'seed-cat-appliance';

// 商品图片全部使用本地占位图（client/public/demo/pN.jpg）。
// 不使用任何外部图床，保证断网 / 离线演示环境下图片也能正常显示。
const DEMO_IMAGE_COUNT = 12;

// 每个商品从不同的占位图开始取，避免所有商品长得一样
const IMAGE_START: Record<string, number> = {
  iphone13: 0,
  mi13: 1,
  ipadair4: 2,
  airpods: 3,
  macbookm1: 4,
  thinkpad: 5,
  mxmaster3s: 6,
  dysonv8: 7,
  midea: 8,
  joyoung: 9,
  legion: 10,
  tuf: 11,
  g15: 4,
  z3air: 7,
};

const img = (slug: string, n: number): string[] => {
  const start = IMAGE_START[slug] ?? 0;
  return Array.from(
    { length: n },
    (_, i) => `/demo/p${((start + i) % DEMO_IMAGE_COUNT) + 1}.jpg`,
  );
};

const PRODUCTS: SeedProduct[] = [
  {
    id: 'seed-prod-01',
    title: 'iPhone 13 128G 蓝色 九成新',
    description: '自用无拆修，电池健康 92%，配件齐全，可当面验机。',
    price: '1899.00',
    originalPrice: '5999.00',
    condition: 'LIKE_NEW',
    categoryId: CATEGORY_PHONE,
    images: img('iphone13', 3),
    viewCount: 328,
    favoriteCount: 42,
  },
  {
    id: 'seed-prod-02',
    title: '小米 13 256G 黑色 仅拆封',
    description: '包装拆开未使用，保修期内，可提供购机发票。',
    price: '1650.00',
    originalPrice: '3999.00',
    condition: 'NEW',
    categoryId: CATEGORY_PHONE,
    images: img('mi13', 2),
    viewCount: 215,
    favoriteCount: 30,
  },
  {
    id: 'seed-prod-03',
    title: 'iPad Air 4 64G WiFi 版',
    description: '屏幕无划痕，边框有轻微使用痕迹，附赠保护壳。',
    price: '2100.00',
    originalPrice: '4799.00',
    condition: 'GOOD',
    categoryId: CATEGORY_PHONE,
    images: img('ipadair4', 3),
    viewCount: 176,
    favoriteCount: 21,
  },
  {
    id: 'seed-prod-04',
    title: 'AirPods Pro 2 代 国行',
    description: '功能正常，耳塞已换新，附充电盒。',
    price: '899.00',
    originalPrice: '1899.00',
    condition: 'LIKE_NEW',
    categoryId: CATEGORY_PHONE,
    images: img('airpods', 2),
    viewCount: 402,
    favoriteCount: 55,
  },
  {
    id: 'seed-prod-05',
    title: 'MacBook Air M1 8G+256G',
    description: '循环充电 180 次，键盘无油光，原装充电器。',
    price: '3899.00',
    originalPrice: '7999.00',
    condition: 'GOOD',
    categoryId: CATEGORY_COMPUTER,
    images: img('macbookm1', 3),
    viewCount: 512,
    favoriteCount: 78,
  },
  {
    id: 'seed-prod-06',
    title: 'ThinkPad X1 Carbon 2021 i7',
    description: '16G 内存，外壳有磕碰不影响使用，已重装系统。',
    price: '3200.00',
    originalPrice: '12999.00',
    condition: 'FAIR',
    categoryId: CATEGORY_COMPUTER,
    images: img('thinkpad', 2),
    viewCount: 143,
    favoriteCount: 12,
  },
  {
    id: 'seed-prod-07',
    title: '罗技 MX Master 3S 无线鼠标',
    description: '静音版，使用两个月，附收纳包。',
    price: '380.00',
    originalPrice: '749.00',
    condition: 'LIKE_NEW',
    categoryId: CATEGORY_COMPUTER,
    images: img('mxmaster3s', 2),
    viewCount: 268,
    favoriteCount: 34,
  },
  {
    id: 'seed-prod-08',
    title: '戴森 V8 无线吸尘器',
    description: '吸力正常，滤网已清洗，含 4 个吸头。',
    price: '1200.00',
    originalPrice: '2999.00',
    condition: 'GOOD',
    categoryId: CATEGORY_APPLIANCE,
    images: img('dysonv8', 3),
    viewCount: 189,
    favoriteCount: 19,
  },
  {
    id: 'seed-prod-09',
    title: '美的电饭煲 4L 智能款',
    description: '搬家闲置，仅用过几次，内胆完好。',
    price: '150.00',
    originalPrice: '399.00',
    condition: 'GOOD',
    categoryId: CATEGORY_APPLIANCE,
    images: img('midea', 2),
    viewCount: 96,
    favoriteCount: 8,
  },
  {
    id: 'seed-prod-10',
    title: '九阳破壁机 Y1',
    description: '功能全好，杯体有轻微划痕，不影响使用。',
    price: '260.00',
    originalPrice: '899.00',
    condition: 'FAIR',
    categoryId: CATEGORY_APPLIANCE,
    images: img('joyoung', 2),
    viewCount: 74,
    favoriteCount: 5,
  },
  // 以下 4 件游戏本专供 AI 自然语言搜索演示：
  // 「九成新2000以内的游戏本」严格匹配就能命中前两件（如移除会让验收用例无结果）
  {
    id: 'seed-prod-11',
    title: '联想拯救者 Y7000P 2021 游戏本 i7/16G/512G',
    description: '九成新，独显直连，散热与键盘无油光，原装电源适配器。',
    price: '1899.00',
    originalPrice: '8299.00',
    condition: 'LIKE_NEW',
    categoryId: CATEGORY_COMPUTER,
    images: img('legion', 3),
    viewCount: 431,
    favoriteCount: 63,
  },
  {
    id: 'seed-prod-12',
    title: '华硕天选 3 游戏本 R7-6800H/16G',
    description: '九成新，屏幕无亮点，含原装包与鼠标。',
    price: '1999.00',
    originalPrice: '7499.00',
    condition: 'LIKE_NEW',
    categoryId: CATEGORY_COMPUTER,
    images: img('tuf', 2),
    viewCount: 356,
    favoriteCount: 48,
  },
  {
    id: 'seed-prod-13',
    title: '戴尔游匣 G15 游戏本 5511',
    description: '八成新，A 面有细划痕，性能正常，已重装系统。',
    price: '2450.00',
    originalPrice: '8999.00',
    condition: 'GOOD',
    categoryId: CATEGORY_COMPUTER,
    images: img('g15', 3),
    viewCount: 208,
    favoriteCount: 27,
  },
  {
    id: 'seed-prod-14',
    title: '机械革命 Z3 Air 游戏本 轻薄款',
    description: '八成新，重量轻便适合带走，电池健康度 88%。',
    price: '1350.00',
    originalPrice: '5699.00',
    condition: 'GOOD',
    categoryId: CATEGORY_COMPUTER,
    images: img('z3air', 2),
    viewCount: 167,
    favoriteCount: 18,
  },
];

// ============================================================
// 历史成交数据：仅用于支撑数据看板，不参与前台展示
// ------------------------------------------------------------
// 为什么单独造一批商品：下单逻辑会把商品置为 SOLD，而上面 14 件商品是
// 首页列表与 AI 搜索的演示依赖。若直接用它们下单，前台会变空。
// 因此这里另造一批「已成交」商品，与订单一一对应。
// ============================================================

const HISTORY_PREFIX = '[历史]';

interface SeedHistoryProduct {
  id: string;
  title: string;
  description: string;
  price: string;
  originalPrice: string;
  condition: SeedCondition;
  categoryId: string;
}

// 50 件，价格从 18 元（二手教材）到 4999 元（MacBook Pro）拉开档次，
// 保证「成交额 Top 5」有区分度，也让趋势图的每日成交额有真实波动
const HISTORY_PRODUCTS: SeedHistoryProduct[] = [
  { id: 'seed-hist-01', title: `${HISTORY_PREFIX} iPhone 12 64G 黑色`, description: '已成交，电池健康度 86%，无维修记录。', price: '2350.00', originalPrice: '5999.00', condition: 'LIKE_NEW', categoryId: CATEGORY_PHONE },
  { id: 'seed-hist-02', title: `${HISTORY_PREFIX} 华为 Mate 40 Pro 8+128`, description: '已成交，后盖有轻微使用痕迹。', price: '2980.00', originalPrice: '6499.00', condition: 'GOOD', categoryId: CATEGORY_PHONE },
  { id: 'seed-hist-03', title: `${HISTORY_PREFIX} 小米手环 7 NFC`, description: '已成交，配件齐全，功能正常。', price: '180.00', originalPrice: '399.00', condition: 'GOOD', categoryId: CATEGORY_PHONE },
  { id: 'seed-hist-04', title: `${HISTORY_PREFIX} 索尼 WH-1000XM4 头戴耳机`, description: '已成交，耳罩全新替换过。', price: '1180.00', originalPrice: '2899.00', condition: 'LIKE_NEW', categoryId: CATEGORY_PHONE },
  { id: 'seed-hist-05', title: `${HISTORY_PREFIX} MacBook Air M2 8G+256G`, description: '已成交，循环次数 92 次，原装充电器。', price: '4200.00', originalPrice: '9499.00', condition: 'LIKE_NEW', categoryId: CATEGORY_COMPUTER },
  { id: 'seed-hist-06', title: `${HISTORY_PREFIX} 联想小新 Air 14 锐龙版`, description: '已成交，屏幕有轻微亮点，不影响使用。', price: '1650.00', originalPrice: '4999.00', condition: 'GOOD', categoryId: CATEGORY_COMPUTER },
  { id: 'seed-hist-07', title: `${HISTORY_PREFIX} 罗技 K380 蓝牙键盘`, description: '已成交，按键手感正常。', price: '120.00', originalPrice: '249.00', condition: 'GOOD', categoryId: CATEGORY_COMPUTER },
  { id: 'seed-hist-08', title: `${HISTORY_PREFIX} 戴尔 27 英寸 2K 显示器`, description: '已成交，无坏点，含 HDMI 线。', price: '780.00', originalPrice: '1899.00', condition: 'GOOD', categoryId: CATEGORY_COMPUTER },
  { id: 'seed-hist-09', title: `${HISTORY_PREFIX} 惠普激光打印机 M17w`, description: '已成交，硒鼓剩余约一半。', price: '420.00', originalPrice: '1099.00', condition: 'FAIR', categoryId: CATEGORY_COMPUTER },
  { id: 'seed-hist-10', title: `${HISTORY_PREFIX} 美的变频空调 1.5 匹`, description: '已成交，安装使用两个夏季，制冷正常。', price: '1580.00', originalPrice: '3699.00', condition: 'GOOD', categoryId: CATEGORY_APPLIANCE },
  { id: 'seed-hist-11', title: `${HISTORY_PREFIX} 九阳电磁炉`, description: '已成交，面板无划痕。', price: '95.00', originalPrice: '259.00', condition: 'GOOD', categoryId: CATEGORY_APPLIANCE },
  { id: 'seed-hist-12', title: `${HISTORY_PREFIX} 飞利浦电动牙刷`, description: '已成交，刷头全新未拆封。', price: '80.00', originalPrice: '399.00', condition: 'NEW', categoryId: CATEGORY_APPLIANCE },
  { id: 'seed-hist-13', title: `${HISTORY_PREFIX} 海尔滚筒洗衣机 8kg`, description: '已成交，搬家出，运转平稳。', price: '1120.00', originalPrice: '2999.00', condition: 'GOOD', categoryId: CATEGORY_APPLIANCE },
  { id: 'seed-hist-14', title: `${HISTORY_PREFIX} 松下空气净化器`, description: '已成交，滤网已更换。', price: '690.00', originalPrice: '1699.00', condition: 'LIKE_NEW', categoryId: CATEGORY_APPLIANCE },
  { id: 'seed-hist-15', title: `${HISTORY_PREFIX} 佳能 EOS M50 微单套机`, description: '已成交，快门数约 8000，含原装镜头。', price: '3150.00', originalPrice: '5999.00', condition: 'LIKE_NEW', categoryId: CATEGORY_PHONE },
  { id: 'seed-hist-16', title: `${HISTORY_PREFIX} 追觅扫地机器人`, description: '已成交，含备用边刷与滤芯。', price: '1340.00', originalPrice: '3299.00', condition: 'GOOD', categoryId: CATEGORY_APPLIANCE },
  { id: 'seed-hist-17', title: `${HISTORY_PREFIX} iPad mini 6 64G`, description: '已成交，屏幕无划痕，附保护套。', price: '2180.00', originalPrice: '3799.00', condition: 'LIKE_NEW', categoryId: CATEGORY_PHONE },
  { id: 'seed-hist-18', title: `${HISTORY_PREFIX} 显示器增高支架`, description: '已成交，实木材质，带抽屉。', price: '150.00', originalPrice: '329.00', condition: 'GOOD', categoryId: CATEGORY_COMPUTER },
  { id: 'seed-hist-19', title: `${HISTORY_PREFIX} 中兴 5G 随身 WiFi`, description: '已成交，含原装数据线。', price: '260.00', originalPrice: '699.00', condition: 'GOOD', categoryId: CATEGORY_PHONE },
  { id: 'seed-hist-20', title: `${HISTORY_PREFIX} 苏泊尔电压力锅`, description: '已成交，内胆完好无涂层脱落。', price: '380.00', originalPrice: '899.00', condition: 'GOOD', categoryId: CATEGORY_APPLIANCE },
  { id: 'seed-hist-21', title: `${HISTORY_PREFIX} 考研数学复习全书`, description: '已成交，二手教材，笔记整齐无破损。', price: '18.00', originalPrice: '68.00', condition: 'GOOD', categoryId: CATEGORY_COMPUTER },
  { id: 'seed-hist-22', title: `${HISTORY_PREFIX} 手机壳 全新未拆封`, description: '已成交，买错型号，未拆封。', price: '25.00', originalPrice: '49.00', condition: 'NEW', categoryId: CATEGORY_PHONE },
  { id: 'seed-hist-23', title: `${HISTORY_PREFIX} USB 3.0 七口集线器`, description: '已成交，带独立供电，接口正常。', price: '35.00', originalPrice: '89.00', condition: 'GOOD', categoryId: CATEGORY_COMPUTER },
  { id: 'seed-hist-24', title: `${HISTORY_PREFIX} 机械键盘 有线 87 键`, description: '已成交，个别键帽有磨损，手感正常。', price: '45.00', originalPrice: '159.00', condition: 'FAIR', categoryId: CATEGORY_COMPUTER },
  { id: 'seed-hist-25', title: `${HISTORY_PREFIX} 无线鼠标 办公静音款`, description: '已成交，含 USB 接收器。', price: '58.00', originalPrice: '129.00', condition: 'GOOD', categoryId: CATEGORY_COMPUTER },
  { id: 'seed-hist-26', title: `${HISTORY_PREFIX} 护眼台灯 LED`, description: '已成交，三档色温可调。', price: '68.00', originalPrice: '199.00', condition: 'LIKE_NEW', categoryId: CATEGORY_APPLIANCE },
  { id: 'seed-hist-27', title: `${HISTORY_PREFIX} 电热水壶 1.5L 不锈钢`, description: '已成交，烧水正常无水垢。', price: '75.00', originalPrice: '199.00', condition: 'GOOD', categoryId: CATEGORY_APPLIANCE },
  { id: 'seed-hist-28', title: `${HISTORY_PREFIX} 蓝牙音箱 便携防水`, description: '已成交，续航正常，音质尚可。', price: '95.00', originalPrice: '259.00', condition: 'GOOD', categoryId: CATEGORY_PHONE },
  { id: 'seed-hist-29', title: `${HISTORY_PREFIX} 华为手环 6 标准版`, description: '已成交，表带全新替换过。', price: '135.00', originalPrice: '349.00', condition: 'GOOD', categoryId: CATEGORY_PHONE },
  { id: 'seed-hist-30', title: `${HISTORY_PREFIX} 便携榨汁机 迷你`, description: '已成交，仅用过几次。', price: '145.00', originalPrice: '399.00', condition: 'LIKE_NEW', categoryId: CATEGORY_APPLIANCE },
  { id: 'seed-hist-31', title: `${HISTORY_PREFIX} 显示器增高架 实木带抽屉`, description: '已成交，收纳键盘刚好。', price: '158.00', originalPrice: '339.00', condition: 'GOOD', categoryId: CATEGORY_COMPUTER },
  { id: 'seed-hist-32', title: `${HISTORY_PREFIX} 飞利浦电动牙刷`, description: '已成交，刷头全新未拆封。', price: '188.00', originalPrice: '459.00', condition: 'NEW', categoryId: CATEGORY_APPLIANCE },
  { id: 'seed-hist-33', title: `${HISTORY_PREFIX} 加湿器 4L 静音`, description: '已成交，雾量正常，无漏水。', price: '210.00', originalPrice: '499.00', condition: 'GOOD', categoryId: CATEGORY_APPLIANCE },
  { id: 'seed-hist-34', title: `${HISTORY_PREFIX} 移动硬盘 1TB USB3.2`, description: '已成交，通电时间短，健康度良好。', price: '235.00', originalPrice: '559.00', condition: 'GOOD', categoryId: CATEGORY_COMPUTER },
  { id: 'seed-hist-35', title: `${HISTORY_PREFIX} 空气炸锅 4L 无油`, description: '已成交，内胆不粘涂层完好。', price: '260.00', originalPrice: '699.00', condition: 'LIKE_NEW', categoryId: CATEGORY_APPLIANCE },
  { id: 'seed-hist-36', title: `${HISTORY_PREFIX} 迷你电饭煲 2L`, description: '已成交，适合单人使用。', price: '285.00', originalPrice: '759.00', condition: 'GOOD', categoryId: CATEGORY_APPLIANCE },
  { id: 'seed-hist-37', title: `${HISTORY_PREFIX} 索尼 WH-CH520 头戴耳机`, description: '已成交，耳罩无脱皮。', price: '320.00', originalPrice: '799.00', condition: 'GOOD', categoryId: CATEGORY_PHONE },
  { id: 'seed-hist-38', title: `${HISTORY_PREFIX} 客制化机械键盘 68 键`, description: '已成交，自润轴体，含备用轴。', price: '420.00', originalPrice: '1099.00', condition: 'GOOD', categoryId: CATEGORY_COMPUTER },
  { id: 'seed-hist-39', title: `${HISTORY_PREFIX} 手持无线吸尘器`, description: '已成交，吸力正常，滤网已清洁。', price: '520.00', originalPrice: '1299.00', condition: 'GOOD', categoryId: CATEGORY_APPLIANCE },
  { id: 'seed-hist-40', title: `${HISTORY_PREFIX} 松下空气净化器`, description: '已成交，滤网已更换。', price: '690.00', originalPrice: '1699.00', condition: 'LIKE_NEW', categoryId: CATEGORY_APPLIANCE },
  { id: 'seed-hist-41', title: `${HISTORY_PREFIX} 佳能喷墨打印机 一体机`, description: '已成交，扫描复印正常，含墨盒。', price: '860.00', originalPrice: '2099.00', condition: 'GOOD', categoryId: CATEGORY_COMPUTER },
  { id: 'seed-hist-42', title: `${HISTORY_PREFIX} AirPods Pro 2 代`, description: '已成交，降噪正常，耳塞已换新。', price: '980.00', originalPrice: '1899.00', condition: 'LIKE_NEW', categoryId: CATEGORY_PHONE },
  { id: 'seed-hist-43', title: `${HISTORY_PREFIX} 扫地机器人 基础款`, description: '已成交，含备用边刷与滤芯。', price: '1080.00', originalPrice: '2599.00', condition: 'GOOD', categoryId: CATEGORY_APPLIANCE },
  { id: 'seed-hist-44', title: `${HISTORY_PREFIX} iPad 9 代 64G`, description: '已成交，屏幕无划痕，附保护套。', price: '1250.00', originalPrice: '2499.00', condition: 'GOOD', categoryId: CATEGORY_PHONE },
  { id: 'seed-hist-45', title: `${HISTORY_PREFIX} 松下微波炉 23L`, description: '已成交，加热正常，转盘完好。', price: '1420.00', originalPrice: '3499.00', condition: 'GOOD', categoryId: CATEGORY_APPLIANCE },
  { id: 'seed-hist-46', title: `${HISTORY_PREFIX} 戴森 V10 无线吸尘器`, description: '已成交，吸力强劲，含 5 个吸头。', price: '2480.00', originalPrice: '3999.00', condition: 'GOOD', categoryId: CATEGORY_APPLIANCE },
  { id: 'seed-hist-47', title: `${HISTORY_PREFIX} 戴尔游匣 G15 游戏本 5511`, description: '已成交，A 面有细划痕，性能正常。', price: '3380.00', originalPrice: '8999.00', condition: 'GOOD', categoryId: CATEGORY_COMPUTER },
  { id: 'seed-hist-48', title: `${HISTORY_PREFIX} iPhone 13 128G 蓝色`, description: '已成交，电池健康度 89%，无维修。', price: '3520.00', originalPrice: '5999.00', condition: 'LIKE_NEW', categoryId: CATEGORY_PHONE },
  { id: 'seed-hist-49', title: `${HISTORY_PREFIX} ThinkPad X1 Carbon 2021`, description: '已成交，外壳有磕碰，已重装系统。', price: '3680.00', originalPrice: '12999.00', condition: 'FAIR', categoryId: CATEGORY_COMPUTER },
  { id: 'seed-hist-50', title: `${HISTORY_PREFIX} MacBook Pro 14 M1 Pro`, description: '已成交，循环充电 156 次，原装充电器。', price: '4999.00', originalPrice: '15999.00', condition: 'LIKE_NEW', categoryId: CATEGORY_COMPUTER },
];

// 历史商品图片：按索引轮转占位图，避免所有商品长得一样
const histImg = (index: number): string[] =>
  Array.from(
    { length: 2 },
    (_, i) => `/demo/p${((index * 2 + i) % DEMO_IMAGE_COUNT) + 1}.jpg`,
  );

// ============================================================
// 历史订单：覆盖全部 6 种状态，时间分布在过去 30 天内
// ------------------------------------------------------------
// daysAgo 的分配依据「状态需要多长时间才可能达成」：
//   已评价 需要 付款→发货→收货→评价 全流程，故放在 3 天前之后
//   已完成 需要 付款→发货→收货，放在 3 天前之后
//   已发货 需要 付款→发货，2 天前即可
//   待付款 / 已取消 不依赖履约流程，可以就在今天
// 这样保证所有时间戳都落在「过去」，不会出现未来时间。
// ============================================================

// ============================================================
// 历史订单：按「30 天非均匀分布」生成，覆盖全部 6 种状态
// ------------------------------------------------------------
// 为什么写死一组起伏数组而不是用随机数：
//   随机数每次 seed 结果都不一样，看图时无法复现，也不好解释；
//   写死数组能精确控制「有空单日、有爆单日」，趋势图看起来才像真实业务。
// ============================================================

type SeedOrderStatus =
  | 'PENDING_PAYMENT'
  | 'PENDING_SHIPMENT'
  | 'SHIPPED'
  | 'COMPLETED'
  | 'REVIEWED'
  | 'CANCELLED';

interface SeedHistoryOrder {
  id: string;
  daysAgo: number;
  // 下单时间在建单时就确定，避免订单与评价两处各自推算导致时间对不上
  createdAt: Date;
  status: SeedOrderStatus;
  productId: string;
  buyerId: string;
  receiverName: string;
  receiverPhone: string;
  // 仅 REVIEWED 需要
  rating?: number;
  reviewContent?: string;
  reviewImages?: string[];
}

const HOUR_MS = 60 * 60 * 1000;

// 相对当前时间计算，保证无论哪天执行 seed，趋势图都有数据
const hoursAgo = (hours: number): Date => new Date(Date.now() - Math.round(hours) * HOUR_MS);

// 30 天的订单量分布，下标 = 距今天数（0 = 今天）。
// 合计 50 单：有空单日（第 4、8、14、19、22、26 天），也有爆单日（第 3 天 5 单）。
const DAY_ORDER_COUNTS: readonly number[] = [
  3, 1, 4, 5, 0, 2, 3, // 近 7 天，共 18 单
  1, 3, 0, 2, 3, 1, 2, // 7~13 天前，共 12 单
  0, 2, 1, 3, 1, 0, 2, // 14~20 天前，共 9 单
  1, 0, 2, 1, 3, 0, 1, // 21~27 天前，共 8 单
  2, 1, // 28~29 天前，共 3 单
];

// 状态与「距今天数」强相关：今天不可能已发货，越早的订单越可能走完全流程。
// 这样各状态的时间戳都落在过去，不会出现未来时间。
const pickStatus = (daysAgo: number, seqInDay: number): SeedOrderStatus => {
  if (daysAgo === 0) return seqInDay % 3 === 2 ? 'CANCELLED' : 'PENDING_PAYMENT';
  if (daysAgo === 1) {
    return (['PENDING_SHIPMENT', 'CANCELLED', 'PENDING_PAYMENT'] as const)[seqInDay % 3];
  }
  if (daysAgo === 2) {
    return (['PENDING_SHIPMENT', 'SHIPPED'] as const)[seqInDay % 2];
  }
  if (daysAgo <= 6) {
    return (['SHIPPED', 'COMPLETED', 'REVIEWED'] as const)[seqInDay % 3];
  }
  // 更早的订单基本都已评价，少数只完成未评价
  return seqInDay % 4 === 3 ? 'COMPLETED' : 'REVIEWED';
};

const REVIEW_TEXTS: readonly string[] = [
  '成色和描述一致，卖家包装很用心，开机一切正常。',
  '实物比图片好看，沟通顺畅，发货很快。',
  '功能都正常，价格合适，就是外观痕迹比想象中明显一点。',
  '用了两周没出问题，性价比不错。',
  '卖家回复及时，配件齐全，整体满意。',
  '符合这个价格，凑合用没问题。',
];

// 按下单时间从近到远生成订单。
// 二手商品单件交易，售出即 SOLD，因此每个商品只被一单消费。
const buildHistoryOrders = (): SeedHistoryOrder[] => {
  const orders: SeedHistoryOrder[] = [];

  for (const [daysAgo, count] of DAY_ORDER_COUNTS.entries()) {
    for (let seqInDay = 0; seqInDay < count; seqInDay += 1) {
      const index = orders.length;
      // 用与商品总数互质的步长取商品，让相邻订单的金额高低交错，
      // 而不是随价格单调递增
      const productNo = ((index * 17) % HISTORY_PRODUCTS.length) + 1;
      const buyerIsFirst = index % 2 === 0;
      const status = pickStatus(daysAgo, seqInDay);

      orders.push({
        id: `seed-order-${String(index + 1).padStart(2, '0')}`,
        daysAgo,
        // 同一天内的订单错开几个小时，避免全部挤在同一时刻
        createdAt: hoursAgo(daysAgo * 24 + 6 + (index % 7)),
        status,
        productId: `seed-hist-${String(productNo).padStart(2, '0')}`,
        buyerId: buyerIsFirst ? 'seed-user-01' : 'seed-user-02',
        receiverName: buyerIsFirst ? '张三' : '王五',
        receiverPhone: buyerIsFirst ? '13800138001' : '13800138002',
        ...(status === 'REVIEWED'
          ? {
              rating: 3 + ((index + daysAgo) % 3),
              reviewContent: REVIEW_TEXTS[index % REVIEW_TEXTS.length],
              reviewImages:
                index % 3 === 0 ? [`/demo/p${(index % DEMO_IMAGE_COUNT) + 1}.jpg`] : [],
            }
          : {}),
      });
    }
  }

  return orders;
};

const HISTORY_ORDERS: SeedHistoryOrder[] = buildHistoryOrders();

// 订单号按「下单时间 + 序号」生成，保持与真实格式一致且唯一
const buildOrderNo = (createdAt: Date, index: number): string => {
  const pad = (n: number, len = 2): string => String(n).padStart(len, '0');
  const ts = `${createdAt.getFullYear()}${pad(createdAt.getMonth() + 1)}${pad(createdAt.getDate())}${pad(createdAt.getHours())}${pad(createdAt.getMinutes())}${pad(createdAt.getSeconds())}`;
  return `${ts}${pad(index, 4)}`;
};

// 根据状态推导各时间戳，保证流程顺序合法且都落在过去
const buildTimestamps = (
  status: SeedOrderStatus,
  createdAt: Date,
  index: number,
): {
  paidAt: Date | null;
  shippedAt: Date | null;
  completedAt: Date | null;
  reviewedAt: Date | null;
  cancelledAt: Date | null;
} => {
  const empty = {
    paidAt: null,
    shippedAt: null,
    completedAt: null,
    reviewedAt: null,
    cancelledAt: null,
  };

  if (status === 'PENDING_PAYMENT') return empty;

  if (status === 'CANCELLED') {
    return { ...empty, cancelledAt: new Date(createdAt.getTime() + (1 + (index % 5)) * HOUR_MS) };
  }

  // 其余状态都已付款
  const paidAt = new Date(createdAt.getTime() + 0.5 * HOUR_MS);
  // 履约时长 20~36 小时，让「平均履约时长」有真实波动
  const shipDelayHours = 20 + (index % 5) * 4;
  const shippedAt = new Date(paidAt.getTime() + shipDelayHours * HOUR_MS);

  if (status === 'PENDING_SHIPMENT') {
    return { ...empty, paidAt };
  }
  if (status === 'SHIPPED') {
    return { ...empty, paidAt, shippedAt };
  }

  const completedAt = new Date(shippedAt.getTime() + 22 * HOUR_MS);
  if (status === 'COMPLETED') {
    return { ...empty, paidAt, shippedAt, completedAt };
  }

  return {
    ...empty,
    paidAt,
    shippedAt,
    completedAt,
    reviewedAt: new Date(completedAt.getTime() + 5 * HOUR_MS),
  };
};

async function main(): Promise<void> {
  console.log('[seed] 开始灌入演示数据...');
  // ---------- 1. 用户：1 管理员 + 1 卖家 + 2 普通用户 ----------
  // 密码全部经 bcryptjs 哈希后入库，禁止明文
  const [adminHash, sellerHash, userHash] = await Promise.all([
    hashPassword(ADMIN_PASSWORD),
    hashPassword(SELLER_PASSWORD),
    hashPassword(USER_PASSWORD),
  ]);

  const admin = await prisma.user.upsert({
    where: { id: 'seed-user-admin' },
    update: { passwordHash: adminHash, role: 'ADMIN', status: 'ACTIVE' },
    create: {
      id: 'seed-user-admin',
      username: 'admin',
      email: 'admin@example.com',
      passwordHash: adminHash,
      nickname: '平台管理员',
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  });

  const seller = await prisma.user.upsert({
    where: { id: 'seed-user-seller' },
    update: { passwordHash: sellerHash, role: 'SELLER', status: 'ACTIVE' },
    create: {
      id: 'seed-user-seller',
      username: 'seller_li',
      email: 'seller_li@example.com',
      passwordHash: sellerHash,
      nickname: '卖家小李',
      role: 'SELLER',
      status: 'ACTIVE',
    },
  });

  const buyers = await Promise.all(
    [
      { id: 'seed-user-01', username: 'user_zhang', email: 'zhang@example.com', nickname: '张三' },
      { id: 'seed-user-02', username: 'user_wang', email: 'wang@example.com', nickname: '王五' },
    ].map((u) =>
      prisma.user.upsert({
        where: { id: u.id },
        update: { passwordHash: userHash, role: 'USER', status: 'ACTIVE' },
        create: { ...u, passwordHash: userHash, role: 'USER', status: 'ACTIVE' },
      }),
    ),
  );

  // ---------- 2. 分类：3 个扁平分类 ----------
  const categorySeeds = [
    { id: CATEGORY_PHONE, name: '手机数码', slug: 'phone', icon: 'Iphone', sortOrder: 1 },
    { id: CATEGORY_COMPUTER, name: '电脑办公', slug: 'computer', icon: 'Monitor', sortOrder: 2 },
    { id: CATEGORY_APPLIANCE, name: '家用电器', slug: 'appliance', icon: 'HomeFilled', sortOrder: 3 },
  ];

  const categories = [];
  for (const c of categorySeeds) {
    categories.push(
      await prisma.category.upsert({
        where: { id: c.id },
        update: { name: c.name, slug: c.slug, icon: c.icon, sortOrder: c.sortOrder, status: 'ENABLED' },
        create: { ...c, status: 'ENABLED' },
      }),
    );
  }

  // ---------- 3. 商品：14 个，全部在售，归属卖家 ----------
  const products = [];
  for (const p of PRODUCTS) {
    const data = {
      title: p.title,
      description: p.description,
      price: p.price, // Decimal 字段传字符串，避免浮点精度问题
      originalPrice: p.originalPrice ?? null,
      images: p.images, // Json 字段直接传字符串数组
      condition: p.condition,
      status: 'ON_SALE' as const,
      stock: 1,
      viewCount: p.viewCount,
      favoriteCount: p.favoriteCount,
      publishedAt: new Date(),
      sellerId: seller.id,
      categoryId: p.categoryId,
    };

    products.push(
      await prisma.product.upsert({
        where: { id: p.id },
        update: data,
        create: { id: p.id, ...data },
      }),
    );
  }

  // ---------- 4. 历史成交商品：状态直接置为 SOLD，不参与前台展示 ----------
  // 前台列表与 AI 搜索都按 status=ON_SALE 过滤，因此 SOLD 天然不会出现
  const historyProducts = new Map<string, { title: string; price: string; image: string }>();

  for (const [index, p] of HISTORY_PRODUCTS.entries()) {
    const images = histImg(index);
    const data = {
      title: p.title,
      description: p.description,
      price: p.price,
      originalPrice: p.originalPrice,
      images,
      condition: p.condition,
      status: 'SOLD' as const,
      stock: 1,
      viewCount: 60 + index * 17,
      favoriteCount: 10 + index * 3,
      publishedAt: hoursAgo(24 * 40 + index),
      sellerId: seller.id,
      categoryId: p.categoryId,
    };

    await prisma.product.upsert({
      where: { id: p.id },
      update: data,
      create: { id: p.id, ...data },
    });

    historyProducts.set(p.id, { title: p.title, price: p.price, image: images[0] });
  }

  // ---------- 5. 历史订单：覆盖全部状态，支撑看板的趋势与分布 ----------
  let reviewCount = 0;

  for (const [index, o] of HISTORY_ORDERS.entries()) {
    const product = historyProducts.get(o.productId);
    if (!product) {
      throw new Error(`[seed] 订单 ${o.id} 引用了不存在的历史商品 ${o.productId}`);
    }

    // 下单时间已在生成时确定，订单与评价共用同一个值，避免两处推算导致时间对不上
    const createdAt = o.createdAt;
    const stamps = buildTimestamps(o.status, createdAt, index);

    const orderData = {
      orderNo: buildOrderNo(createdAt, index + 1),
      buyerId: o.buyerId,
      sellerId: seller.id,
      totalAmount: product.price,
      status: o.status,
      receiverName: o.receiverName,
      receiverPhone: o.receiverPhone,
      receiverAddress: '北京市海淀区中关村大街 1 号 演示地址',
      remark: null,
      ...stamps,
      createdAt,
    };

    // 明细用 deleteMany + create 重建，保证重复执行 seed 时不会因
    // @@unique([orderId, productId]) 冲突而失败
    const itemData = {
      productId: o.productId,
      title: product.title,
      image: product.image,
      price: product.price,
      quantity: 1,
      subtotal: product.price,
      status:
        o.status === 'SHIPPED' || o.status === 'COMPLETED' || o.status === 'REVIEWED'
          ? ('SHIPPED' as const)
          : o.status === 'CANCELLED'
            ? ('CANCELLED' as const)
            : ('PENDING' as const),
      createdAt,
    };

    await prisma.order.upsert({
      where: { id: o.id },
      update: { ...orderData, items: { deleteMany: {}, create: [itemData] } },
      create: { id: o.id, ...orderData, items: { create: [itemData] } },
    });
  }

  // ---------- 6. 评价：仅已评价订单 ----------
  // 先按订单前缀清掉旧的种子评价再重建。
  // 不能只用 upsert：评价的唯一键是 (orderId, productId, reviewerId)，
  // 而订单与商品的配对关系每次生成都可能变，旧配对会变成孤儿数据。
  await prisma.review.deleteMany({ where: { orderId: { startsWith: 'seed-order-' } } });

  for (const [index, o] of HISTORY_ORDERS.entries()) {
    if (o.status !== 'REVIEWED' || !o.rating) continue;

    const product = historyProducts.get(o.productId);
    if (!product) continue;

    // 复用订单同一套时间戳推导，保证评价时间不晚于现在、也不早于下单
    const stamps = buildTimestamps(o.status, o.createdAt, index);

    await prisma.review.create({
      data: {
        orderId: o.id,
        productId: o.productId,
        reviewerId: o.buyerId,
        revieweeId: seller.id,
        rating: o.rating,
        content: o.reviewContent ?? null,
        images: o.reviewImages ?? [],
        status: 'VISIBLE',
        ...(stamps.reviewedAt ? { createdAt: stamps.reviewedAt } : {}),
      },
    });
    reviewCount += 1;
  }

  // ---------- 6.5 在售商品的演示评价 ----------
  // 真实业务里，在售商品尚未成交，自然没有评价。
  // 但商品详情页的「商品评价」板块需要可见内容，否则演示时永远是空状态。
  //
  // 做法：复用已完成的种子订单作为载体，为若干在售商品补一批历史评价。
  // 只新增 Review 行，**不新增订单**，因此订单数 / GMV / 趋势图口径完全不受影响。
  // 用确定性 id（seed-review-onsale-*）标记，便于幂等重建与清理。
  const REVIEWED_SEED_ORDERS = HISTORY_ORDERS.filter((o) => o.status === 'REVIEWED');

  const ON_SALE_REVIEW_PLAN: readonly { productIndex: number; ratings: readonly number[] }[] = [
    { productIndex: 10, ratings: [5, 4, 5] }, // seed-prod-11 联想拯救者
    { productIndex: 11, ratings: [5, 5, 4] }, // seed-prod-12 华硕天选
    { productIndex: 12, ratings: [5, 4, 4] }, // seed-prod-13 戴尔游匣
    { productIndex: 0, ratings: [5, 4, 5] }, // seed-prod-01 iPhone 13
    { productIndex: 4, ratings: [4, 5] }, // seed-prod-05 MacBook Air M1
    { productIndex: 7, ratings: [5, 3, 4] }, // seed-prod-08 戴森 V8
    { productIndex: 13, ratings: [4, 5] }, // seed-prod-14 机械革命
  ];

  await prisma.review.deleteMany({ where: { id: { startsWith: 'seed-review-onsale-' } } });

  let onSaleReviewCount = 0;
  let planCursor = 0;

  for (const plan of ON_SALE_REVIEW_PLAN) {
    const product = products[plan.productIndex];
    if (!product) continue;

    for (const [i, rating] of plan.ratings.entries()) {
      const order = REVIEWED_SEED_ORDERS[planCursor % REVIEWED_SEED_ORDERS.length];
      planCursor += 1;
      if (!order) continue;

      // 评价时间：越靠后的条目越早，形成自然的时间顺序
      const createdAt = hoursAgo(24 * (6 + i * 3) + plan.productIndex);

      await prisma.review.create({
        data: {
          id: `seed-review-onsale-${String(onSaleReviewCount + 1).padStart(2, '0')}`,
          orderId: order.id,
          productId: product.id,
          reviewerId: order.buyerId,
          revieweeId: seller.id,
          rating,
          content: REVIEW_TEXTS[(plan.productIndex + i) % REVIEW_TEXTS.length],
          images: i === 0 ? [`/demo/p${(plan.productIndex % DEMO_IMAGE_COUNT) + 1}.jpg`] : [],
          status: 'VISIBLE',
          createdAt,
        },
      });
      onSaleReviewCount += 1;
    }
  }

  // ---------- 7. 清理陈旧种子数据 ----------
  // 订单/商品数量将来若调整（比如从 20 条扩到 50 条），旧 id 会残留在库里。
  // 这里只删「seed- 前缀但已不在当前生成集合里」的记录，绝不触碰其他数据。
  const currentOrderIds = HISTORY_ORDERS.map((o) => o.id);
  const currentProductIds = HISTORY_PRODUCTS.map((p) => p.id);
  const staleOrders = await prisma.order.deleteMany({
    where: { id: { startsWith: 'seed-order-' }, NOT: { id: { in: currentOrderIds } } },
  });
  const staleProducts = await prisma.product.deleteMany({
    where: { id: { startsWith: 'seed-hist-' }, NOT: { id: { in: currentProductIds } } },
  });
  if (staleOrders.count > 0 || staleProducts.count > 0) {
    console.log(
      `[seed] 已清理陈旧种子数据：订单 ${staleOrders.count} 条、商品 ${staleProducts.count} 件`,
    );
  }

  console.log('[seed] 完成：');
  console.log(`  用户    ${1 + 1 + buyers.length} 个（管理员 ${admin.username} / 卖家 ${seller.username} / 买家 ${buyers.map((b) => b.username).join('、')}）`);
  console.log(`  分类    ${categories.length} 个（${categories.map((c) => c.name).join('、')}）`);
  console.log(`  商品    ${products.length} 个在售 + ${historyProducts.size} 个历史成交（SOLD，不参与前台）`);
  console.log(`  订单    ${HISTORY_ORDERS.length} 条（覆盖全部状态，时间分布在近 30 天，供数据看板使用）`);
  console.log(`  评价    ${reviewCount} 条（来自已评价订单）`);
  console.log(`          + ${onSaleReviewCount} 条在售商品演示评价（供详情页评价板块展示）`);
  console.log('[seed] 演示密码：admin=Admin@123456  seller_li=Seller@123456  user_*=User@123456');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error('[seed] 失败：', error);
    await prisma.$disconnect();
    process.exit(1);
  });
