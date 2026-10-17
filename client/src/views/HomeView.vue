<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { getProducts } from '@/api/product'
import { getCategories } from '@/api/category'
import { searchByAi } from '@/api/ai'
import { CONDITION_LABEL } from '@/constants/status'
import type { AiSearchResult, Category, Product, ProductCondition } from '@/types/api'

const router = useRouter()

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
    <!-- AI 自然语言搜索 -->
    <el-card shadow="never" class="ai-card">
      <div class="ai-bar">
        <el-input
          v-model="aiQuery"
          size="large"
          clearable
          placeholder="用一句话说出你的需求，例如：九成新 2000 以内的游戏本"
          @keyup.enter="onAiSearch"
        >
          <template #prefix>
            <span class="ai-badge">AI</span>
          </template>
        </el-input>
        <el-button type="primary" size="large" :loading="aiLoading" @click="onAiSearch">
          智能搜索
        </el-button>
      </div>

      <!-- 解析结果：让用户看到 AI 到底理解了哪些条件 -->
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
    </el-card>

    <!-- 筛选栏 -->
    <el-card shadow="never" class="filter-card">
      <div class="filter-bar">
        <el-input
          v-model="filters.keyword"
          placeholder="搜索商品标题或描述"
          clearable
          style="width: 240px"
          @keyup.enter="onSearch"
        />
        <el-select v-model="filters.categoryId" placeholder="全部分类" clearable style="width: 160px">
          <el-option
            v-for="c in categories"
            :key="c.id"
            :label="c.name"
            :value="c.id"
          />
        </el-select>
        <el-select v-model="filters.condition" placeholder="全部成色" clearable style="width: 160px">
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
          style="width: 120px"
        />
        <span class="sep">—</span>
        <el-input-number
          v-model="filters.priceMax"
          :min="0"
          :precision="2"
          placeholder="最高价"
          :controls="false"
          style="width: 120px"
        />
        <el-button type="primary" @click="onSearch">搜索</el-button>
        <el-button @click="onReset">重置</el-button>
      </div>
    </el-card>

    <!-- 商品网格 -->
    <div v-loading="loading" class="grid-wrap">
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
.filter-card {
  margin-bottom: 16px;
}

.ai-card {
  margin-bottom: 16px;
}

.ai-bar {
  display: flex;
  align-items: center;
  gap: 16px;
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
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 16px;
}

.ai-parsed-label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.ai-source {
  margin-left: auto;
}

.ai-alert {
  margin-top: 16px;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.sep {
  color: var(--el-text-color-secondary);
}

.product-card {
  margin-bottom: 16px;
  cursor: pointer;
}

.cover {
  height: 160px;
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
}

.price {
  color: var(--el-color-danger);
  font-weight: 600;
  font-size: 16px;
}

.condition {
  font-size: 12px;
  color: var(--el-text-color-secondary);
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
</style>
