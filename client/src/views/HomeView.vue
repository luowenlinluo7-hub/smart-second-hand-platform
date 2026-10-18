<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { getProducts } from '@/api/product'
import { getCategories } from '@/api/category'
import { searchByAi } from '@/api/ai'
import { useIsMobile } from '@/composables/useIsMobile'
import { CONDITION_LABEL } from '@/constants/status'
import type { AiSearchResult, Category, Product, ProductCondition } from '@/types/api'

const router = useRouter()
const { isMobile } = useIsMobile()

const loading = ref(false)
const products = ref<Product[]>([])
const total = ref(0)
const categories = ref<Category[]>([])

const filters = reactive({
  keyword: '',
  categoryId: '',
  condition: '' as '' | ProductCondition,
  priceMin: undefined as number | undefined,
  priceMax: undefined as number | undefined,
})

const page = ref(1)
const pageSize = ref(12)

// AI 搜索状态：aiResult 非空时说明当前列表来自 AI 搜索，而不是手动筛选
const aiQuery = ref('')
const aiLoading = ref(false)
const aiResult = ref<AiSearchResult | null>(null)

// ---------- Hero 交互 ----------
const gridRef = ref<HTMLElement | null>(null)
const searchFocused = ref(false)

// 窄屏输入框装不下长示例，换成更短的问法，避免占位文字被截成半句
const searchPlaceholder = computed<string>(() =>
  isMobile.value ? '说一句需求，AI 帮你挑' : '说一句你的需求，例如：2000 以内的游戏本',
)

// 提示词胶囊：文案对齐 seed 里真实在售商品，保证点击后一定有结果
const HERO_PILLS = [
  '九成新的 iPhone 13',
  '2000 以内的游戏本',
  '无线鼠标',
  '500 以内的小家电',
]

// 平滑滚动到商品列表。减去导航栏高度，避免列表标题被顶部挡住。
// 用户开启「减弱动效」时改为瞬间跳转（WCAG 2.3.3）。
const scrollToProducts = (): void => {
  const target = gridRef.value
  if (!target) return
  const headerH =
    Number.parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--header-h'),
      10,
    ) || 0
  const top = Math.max(0, target.getBoundingClientRect().top + window.scrollY - headerH)
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  window.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' })
}

// 条件来源的中文说明，让用户知道这次是模型解析还是降级/本地规则
const aiSourceText = computed<string>(() => {
  switch (aiResult.value?.source) {
    case 'ai':
      return 'AI 解析'
    case 'mock':
      return '本地规则解析'
    case 'fallback':
      return '已降级为关键词匹配'
    default:
      return ''
  }
})

// 是否至少解析出了一个条件，用于决定要不要显示「未识别出具体条件」
const hasParsedFilters = computed<boolean>(() => {
  const parsed = aiResult.value?.parsed
  if (!parsed) {
    return false
  }
  return Boolean(
    parsed.category ||
      parsed.condition ||
      parsed.priceMin !== null ||
      parsed.priceMax !== null ||
      parsed.keyword,
  )
})

const fetchProducts = async (): Promise<void> => {
  loading.value = true
  // 手动筛选会覆盖 AI 结果，先把解析标签清掉，避免展示与实际列表不一致
  aiResult.value = null
  try {
    const result = await getProducts({
      keyword: filters.keyword || undefined,
      categoryId: filters.categoryId || undefined,
      condition: filters.condition || undefined,
      priceMin: filters.priceMin,
      priceMax: filters.priceMax,
      page: page.value,
      pageSize: pageSize.value,
    })
    products.value = result.list
    total.value = result.total
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '加载失败')
  } finally {
    loading.value = false
  }
}

// AI 搜索：分页时复用同一句话重新查询
const runAiSearch = async (targetPage: number): Promise<void> => {
  aiLoading.value = true
  try {
    const result = await searchByAi({
      query: aiQuery.value.trim(),
      page: targetPage,
      pageSize: pageSize.value,
    })
    aiResult.value = result
    products.value = result.list
    total.value = result.total
    page.value = targetPage
    if (targetPage === 1 && result.total === 0) {
      ElMessage.info('没有找到匹配的商品，换个说法试试')
    }
    // Hero 占据了首屏，搜完若不滚动，用户看不到结果，会以为没反应
    if (targetPage === 1 && result.total > 0) {
      scrollToProducts()
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : 'AI 搜索失败')
  } finally {
    aiLoading.value = false
  }
}

const onAiSearch = (): void => {
  if (!aiQuery.value.trim()) {
    ElMessage.warning('请输入搜索内容')
    return
  }
  // AI 搜索与手动筛选是两条独立路径，先清空手动条件避免两套条件互相干扰
  filters.keyword = ''
  filters.categoryId = ''
  filters.condition = ''
  filters.priceMin = undefined
  filters.priceMax = undefined
  runAiSearch(1)
}

// 点胶囊：填入输入框并立即搜索，省去用户手打
const onPickPill = (text: string): void => {
  aiQuery.value = text
  onAiSearch()
}

// 搜索：重置到第一页
const onSearch = (): void => {
  page.value = 1
  fetchProducts()
}

const onReset = (): void => {
  filters.keyword = ''
  filters.categoryId = ''
  filters.condition = ''
  filters.priceMin = undefined
  filters.priceMax = undefined
  aiQuery.value = ''
  aiResult.value = null
  onSearch()
}

const onPageChange = (p: number): void => {
  page.value = p
  // AI 结果分页要带着原句重查，否则翻页会掉回手动筛选
  if (aiResult.value) {
    runAiSearch(p)
    return
  }
  fetchProducts()
}

const goDetail = (id: string): void => {
  router.push(`/products/${id}`)
}

onMounted(async () => {
  try {
    categories.value = await getCategories()
  } catch {
    // 分类加载失败不阻断商品列表
  }
  fetchProducts()
})
</script>

<template>
  <div class="page">
    <!-- Hero：品牌标语 + 唯一的核心 AI 搜索入口 -->
    <section class="hero">
      <!-- 柔光斑：纯装饰，不进无障碍树 -->
      <div class="hero-glow" aria-hidden="true" />

      <div class="hero-inner">
        <h1 class="hero-title">让二手交易，像聊天一样简单</h1>
        <p class="hero-subtitle">一句话说出需求，AI 帮你找到合适的商品</p>

        <div class="hero-search" :class="{ 'is-focus': searchFocused }">
          <el-input
            v-model="aiQuery"
            size="large"
            clearable
            class="hero-input"
            :placeholder="searchPlaceholder"
            @keyup.enter="onAiSearch"
            @focus="searchFocused = true"
            @blur="searchFocused = false"
          >
            <template #prefix>
              <span class="ai-badge">AI</span>
            </template>
          </el-input>
          <div class="hero-buttons">
            <el-button
              type="primary"
              size="large"
              class="hero-btn-primary"
              :loading="aiLoading"
              @click="onAiSearch"
            >
              智能搜索
            </el-button>
            <el-button size="large" class="hero-btn-ghost" @click="scrollToProducts">
              浏览全部商品
            </el-button>
          </div>
        </div>

        <div class="hero-pills">
          <button
            v-for="pill in HERO_PILLS"
            :key="pill"
            type="button"
            class="hero-pill"
            @click="onPickPill(pill)"
          >
            {{ pill }}
          </button>
        </div>
      </div>
    </section>

    <!-- AI 解析结果：条件属于「结果」，所以放在结果区而不是 Hero 里 -->
    <div v-if="aiResult" class="ai-parsed">
      <span class="ai-parsed-label">已识别：</span>
      <el-tag v-if="aiResult.parsed.category" type="primary" effect="light">
        品类 {{ aiResult.parsed.category.name }}
      </el-tag>
      <el-tag v-if="aiResult.parsed.conditionLabel" type="success" effect="light">
        成色 {{ aiResult.parsed.conditionLabel }}
      </el-tag>
      <el-tag v-if="aiResult.parsed.priceMax !== null" type="warning" effect="light">
        预算 ≤ ¥{{ aiResult.parsed.priceMax }}
      </el-tag>
      <el-tag v-if="aiResult.parsed.priceMin !== null" type="warning" effect="light">
        价格 ≥ ¥{{ aiResult.parsed.priceMin }}
      </el-tag>
      <el-tag v-if="aiResult.parsed.keyword" type="info" effect="light">
        关键词 {{ aiResult.parsed.keyword }}
      </el-tag>
      <el-tag v-if="!hasParsedFilters" type="info" effect="plain">未识别出具体条件</el-tag>
      <el-tag size="small" effect="plain" class="ai-source">{{ aiSourceText }}</el-tag>
    </div>

    <!-- 条件过严被放宽时的提示 -->
    <el-alert
      v-if="aiResult?.relaxedNote"
      :title="aiResult.relaxedNote"
      type="warning"
      show-icon
      :closable="false"
      class="ai-alert"
    />

    <!-- 补充筛选：AI 搜索之外的传统筛选 -->
    <el-card shadow="never" class="filter-card">
      <div class="filter-head">
        <span class="filter-title">补充筛选</span>
        <el-button v-if="aiResult" text type="primary" size="small" @click="onReset">
          清除 AI 搜索结果
        </el-button>
      </div>
      <div class="filter-bar">
        <el-input
          v-model="filters.keyword"
          placeholder="搜索商品标题或描述"
          clearable
          class="filter-field filter-keyword"
          @keyup.enter="onSearch"
        />
        <el-select
          v-model="filters.categoryId"
          placeholder="全部分类"
          clearable
          class="filter-field"
        >
          <el-option
            v-for="c in categories"
            :key="c.id"
            :label="c.name"
            :value="c.id"
          />
        </el-select>
        <el-select
          v-model="filters.condition"
          placeholder="全部成色"
          clearable
          class="filter-field"
        >
          <el-option
            v-for="(label, value) in CONDITION_LABEL"
            :key="value"
            :label="label"
            :value="value"
          />
        </el-select>
        <el-input-number
          v-model="filters.priceMin"
          :min="0"
          :precision="2"
          placeholder="最低价"
          :controls="false"
          class="filter-field filter-price"
        />
        <span class="sep">—</span>
        <el-input-number
          v-model="filters.priceMax"
          :min="0"
          :precision="2"
          placeholder="最高价"
          :controls="false"
          class="filter-field filter-price"
        />
        <el-button type="primary" @click="onSearch">搜索</el-button>
        <el-button @click="onReset">重置</el-button>
      </div>
    </el-card>

    <!-- 商品网格：ref 作为「浏览全部商品」与 AI 搜索后的滚动锚点 -->
    <div ref="gridRef" v-loading="loading" class="grid-wrap">
      <el-empty v-if="!loading && products.length === 0" description="暂无商品" />

      <el-row v-else :gutter="16">
        <el-col v-for="p in products" :key="p.id" :xs="12" :sm="8" :md="6" :lg="4">
          <el-card shadow="hover" class="product-card" @click="goDetail(p.id)">
            <div class="cover">
              <img v-if="p.images && p.images.length" :src="p.images[0]" alt="封面" />
              <div v-else class="cover-placeholder">暂无图片</div>
            </div>
            <div class="title">{{ p.title }}</div>
            <div class="meta">
              <span class="price">¥{{ p.price }}</span>
              <span class="condition">{{ CONDITION_LABEL[p.condition] }}</span>
            </div>
            <div class="meta-bottom">
              <span>{{ p.category.name }}</span>
              <span>{{ p.viewCount }} 浏览</span>
            </div>
          </el-card>
        </el-col>
      </el-row>
    </div>

    <!-- 分页 -->
    <div class="pagination">
      <el-pagination
        :current-page="page"
        :page-size="pageSize"
        :total="total"
        layout="total, prev, pager, next"
        @current-change="onPageChange"
      />
    </div>
  </div>
</template>

<style scoped>
/* ---------- Hero ---------- */
.hero {
  position: relative;
  /* 光斑不溢出圆角 */
  overflow: hidden;
  margin-bottom: var(--space-2);
  padding: var(--space-6) var(--space-4) var(--space-5);
  border-radius: var(--hero-radius);
  /* 暖白底：与全局 #faf9f7 同色系，靠光斑制造层次，而不是换底色 */
  background-color: var(--el-bg-color-overlay);
  border: 1px solid var(--el-border-color-lighter);
}

/* 柔光斑：用径向渐变做柔和衰减，不用 filter: blur ——
   少一层 GPU 模糊开销，且边缘更干净不发灰 */
.hero-glow {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(circle at 88% -10%, var(--hero-glow-strong), transparent 58%),
    radial-gradient(circle at 4% 104%, var(--hero-glow-soft), transparent 52%);
}

.hero-inner {
  position: relative;
  max-width: 880px;
  margin: 0 auto;
  text-align: center;
}

.hero-title {
  margin: 0;
  font-family: var(--font-title);
  font-size: var(--hero-title-size);
  font-weight: 700;
  line-height: 1.25;
  letter-spacing: 0.01em;
  color: var(--el-text-color-primary);
}

.hero-subtitle {
  margin: var(--space-2) 0 0;
  font-size: 15px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
}

.hero-search {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  margin-top: var(--space-4);
}

/* 输入框是视觉中心：纯白浮起 + 弥散暖橙阴影 */
.hero-search .hero-input {
  flex: 1;
  min-width: 0;
}

.hero-search :deep(.el-input__wrapper) {
  height: var(--hero-input-h);
  padding: 0 var(--space-2);
  border-radius: var(--hero-radius);
  background-color: var(--brand-surface-raised);
  box-shadow: var(--shadow-hero-input);
  transition: box-shadow 0.2s ease;
}

/* 聚焦：加深投影 + 一圈淡橙发光。同时覆盖 EP 默认的 inset 描边。 */
.hero-search.is-focus :deep(.el-input__wrapper) {
  box-shadow:
    0 0 0 1px var(--el-color-primary-light-7) inset,
    var(--shadow-hero-input-focus);
}

.hero-search :deep(.el-input__inner) {
  font-size: 15px;
}

.hero-buttons {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex: 0 0 auto;
}

.hero-btn-primary,
.hero-btn-ghost {
  height: var(--hero-input-h);
  padding: 0 var(--space-3);
  border-radius: var(--hero-radius);
  font-size: 15px;
}

.hero-btn-primary {
  margin-left: 0;
}

/* 次级按钮：白底 + 橙边橙字，降低视觉噪点 */
.hero-btn-ghost {
  margin-left: 0;
  background-color: var(--brand-surface-raised);
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
}

.hero-btn-ghost:hover,
.hero-btn-ghost:focus {
  background-color: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
}

/* 快捷提示词胶囊 */
.hero-pills {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-1);
  margin-top: var(--space-2);
}

.hero-pill {
  padding: 6px var(--space-2);
  border: 1px solid var(--el-border-color-light);
  border-radius: var(--el-border-radius-round);
  background-color: transparent;
  color: var(--el-text-color-regular);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.5;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    color 0.2s ease,
    background-color 0.2s ease;
}

.hero-pill:hover {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
  background-color: var(--el-color-primary-light-9);
}

.hero-pill:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}

.ai-badge {
  display: inline-block;
  padding: 0 8px;
  border-radius: 8px;
  background: var(--el-color-primary);
  color: var(--brand-on-primary);
  font-size: 12px;
  font-weight: 600;
  line-height: 20px;
  letter-spacing: 0.5px;
}

.ai-parsed {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex-wrap: wrap;
  /* 独立区块：上留白由 Hero 的 margin-bottom 提供，这里只补下方间距 */
  margin: 0 0 var(--space-2);
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: var(--el-card-border-radius);
  background-color: var(--el-bg-color-overlay);
}

.ai-parsed-label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.ai-source {
  margin-left: auto;
}

.ai-alert {
  margin: 0 0 var(--space-2);
}

/* 补充筛选：AI 之外的传统筛选，视觉上比 Hero 弱 */
.filter-card {
  margin-bottom: var(--space-2);
}

.filter-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-1);
  margin-bottom: var(--space-1);
}

.filter-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex-wrap: wrap;
}

/* 筛选控件宽度集中在此，避免散落的内联固定宽度 */
.filter-field {
  width: 160px;
}

.filter-keyword {
  width: 240px;
}

.filter-price {
  width: 120px;
}

.sep {
  color: var(--el-text-color-secondary);
}

.product-card {
  margin-bottom: 16px;
  cursor: pointer;
}

.cover {
  height: var(--card-cover-h);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--el-fill-color-light);
  border-radius: 4px;
}

.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-placeholder {
  color: var(--el-text-color-placeholder);
}

.title {
  margin: 10px 0 6px;
  font-size: 14px;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-1);
  flex-wrap: wrap;
}

.price {
  color: var(--el-color-danger);
  font-weight: 600;
  font-size: 16px;
}

.condition {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}

.meta-bottom {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

.pagination {
  display: flex;
  justify-content: center;
  margin-top: 16px;
}

/* ---------- 移动端 ---------- */
@media (max-width: 767px) {
  /* Hero：收窄内边距，输入框与按钮纵向铺满，避免任何截断 */
  .hero {
    padding: var(--space-4) var(--space-2);
  }

  .hero-subtitle {
    margin-top: var(--space-1);
    font-size: 13px;
  }

  .hero-search {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-1);
    margin-top: var(--space-3);
  }

  /* 两枚按钮等分一行，都能完整显示文字 */
  .hero-buttons {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-1);
  }

  .hero-btn-primary,
  .hero-btn-ghost {
    width: 100%;
    padding: 0 var(--space-2);
    font-size: 14px;
  }

  .hero-pills {
    margin-top: var(--space-2);
  }

  .hero-pill {
    font-size: 12px;
  }

  /* 筛选栏：两列网格，关键词独占一行，价格区间各占一列 */
  .filter-bar {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-1);
  }

  .filter-field,
  .filter-keyword,
  .filter-price {
    width: 100%;
  }

  .filter-keyword {
    grid-column: 1 / -1;
  }

  /* 「—」在网格里单独占一格毫无意义，移动端隐藏 */
  .sep {
    display: none;
  }

  .filter-bar .el-button {
    width: 100%;
    margin-left: 0;
  }
}
</style>
