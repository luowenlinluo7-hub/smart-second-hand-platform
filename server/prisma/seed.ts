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

  console.log('[seed] 完成：');
  console.log(`  用户    ${1 + 1 + buyers.length} 个（管理员 ${admin.username} / 卖家 ${seller.username} / 买家 ${buyers.map((b) => b.username).join('、')}）`);
  console.log(`  分类    ${categories.length} 个（${categories.map((c) => c.name).join('、')}）`);
  console.log(`  商品    ${products.length} 个（全部 ON_SALE，归属 ${seller.username}）`);
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
