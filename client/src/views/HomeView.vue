<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { getProducts } from '@/api/product'
import { getCategories } from '@/api/category'
import type { Category, Product, ProductCondition } from '@/types/api'

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

const conditionLabels: Record<ProductCondition, string> = {
  NEW: '全新',
  LIKE_NEW: '几乎全新',
  GOOD: '轻微使用痕迹',
  FAIR: '明显使用痕迹',
}

const fetchProducts = async (): Promise<void> => {
  loading.value = true
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
  onSearch()
}

const onPageChange = (p: number): void => {
  page.value = p
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
  <div class="product-page">
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
            v-for="(label, value) in conditionLabels"
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
              <span class="condition">{{ conditionLabels[p.condition] }}</span>
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
.product-page {
  max-width: 1200px;
  margin: 0 auto;
}

.filter-card {
  margin-bottom: 16px;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.sep {
  color: #909399;
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
  background: #f5f7fa;
  border-radius: 4px;
}

.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-placeholder {
  color: #c0c4cc;
}

.title {
  margin: 10px 0 6px;
  font-size: 14px;
  color: #303133;
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
  color: #909399;
}

.meta-bottom {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  font-size: 12px;
  color: #c0c4cc;
}

.pagination {
  display: flex;
  justify-content: center;
  margin-top: 16px;
}
</style>
