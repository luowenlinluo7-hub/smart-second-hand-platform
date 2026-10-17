<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { deleteProduct, getMyProducts, relistProduct } from '@/api/product'
import { PRODUCT_STATUS_LABEL, PRODUCT_STATUS_TABS, PRODUCT_STATUS_TAG_TYPE } from '@/constants/status'
import type { Product, ProductStatus } from '@/types/api'

const router = useRouter()

const loading = ref(false)
const list = ref<Product[]>([])
const counts = ref<Record<ProductStatus, number> | null>(null)
const total = ref(0)

const activeTab = ref<'ALL' | ProductStatus>('ALL')
const page = ref(1)
const pageSize = ref(10)

const fetchList = async (): Promise<void> => {
  loading.value = true
  try {
    const result = await getMyProducts({
      status: activeTab.value === 'ALL' ? undefined : activeTab.value,
      page: page.value,
      pageSize: pageSize.value,
    })
    list.value = result.list
    total.value = result.total
    counts.value = result.counts
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '加载失败')
  } finally {
    loading.value = false
  }
}

const onTabChange = (): void => {
  page.value = 1
  fetchList()
}

const onPageChange = (p: number): void => {
  page.value = p
  fetchList()
}

// 下架
const onRemove = async (p: Product): Promise<void> => {
  try {
    await ElMessageBox.confirm(`确定下架「${p.title}」吗？`, '提示', { type: 'warning' })
    await deleteProduct(p.id)
    ElMessage.success('已下架')
    fetchList()
  } catch (error) {
    // 取消操作时 ElMessageBox 抛 'cancel'，静默处理
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error(error instanceof Error ? error.message : '操作失败')
    }
  }
}

// 重新上架
const onRelist = async (p: Product): Promise<void> => {
  try {
    await relistProduct(p.id)
    ElMessage.success('已重新提交审核')
    fetchList()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '操作失败')
  }
}

const goEdit = (id: string): void => {
  router.push(`/products/${id}/edit`)
}

// 全部状态合计
const sumCounts = (): number => {
  if (!counts.value) return 0
  return Object.values(counts.value).reduce((a, b) => a + b, 0)
}

onMounted(fetchList)
</script>

<template>
  <div class="mine-page">
    <el-card shadow="never">
      <template #header>
        <div class="card-header">
          <span>我的商品</span>
          <el-button type="primary" @click="router.push('/publish')">发布商品</el-button>
        </div>
      </template>

      <el-tabs v-model="activeTab" @tab-change="onTabChange">
        <el-tab-pane v-for="tab in PRODUCT_STATUS_TABS" :key="tab.value" :name="tab.value">
          <template #label>
            {{ tab.label }}
            <el-badge
              v-if="counts"
              :value="tab.value === 'ALL' ? sumCounts() : counts[tab.value as ProductStatus]"
              :hidden="tab.value === 'ALL' ? sumCounts() === 0 : (counts[tab.value as ProductStatus] ?? 0) === 0"
              class="tab-badge"
            />
          </template>
        </el-tab-pane>
      </el-tabs>

      <div v-loading="loading">
        <el-empty v-if="!loading && list.length === 0" description="暂无商品" />

        <el-table v-else :data="list" style="width: 100%">
          <el-table-column label="商品" min-width="260">
            <template #default="{ row }: { row: Product }">
              <div class="product-cell">
                <img v-if="row.images && row.images.length" :src="row.images[0]" class="thumb" alt="封面" />
                <div v-else class="thumb placeholder" />
                <span class="p-title">{{ row.title }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="价格" width="110">
            <template #default="{ row }: { row: Product }">¥{{ row.price }}</template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }: { row: Product }">
              <el-tag :type="PRODUCT_STATUS_TAG_TYPE[row.status]" size="small">
                {{ PRODUCT_STATUS_LABEL[row.status] }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="浏览" width="80" prop="viewCount" />
          <el-table-column label="操作" width="220" fixed="right">
            <template #default="{ row }: { row: Product }">
              <el-button
                v-if="row.status === 'ON_SALE'"
                size="small"
                type="primary"
                link
                @click="goEdit(row.id)"
              >
                编辑
              </el-button>
              <el-button
                v-if="row.status === 'ON_SALE'"
                size="small"
                type="danger"
                link
                @click="onRemove(row)"
              >
                下架
              </el-button>
              <el-button
                v-if="row.status === 'OFF_SHELF' || row.status === 'REJECTED'"
                size="small"
                type="warning"
                link
                @click="onRelist(row)"
              >
                重新上架
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="pagination">
        <el-pagination
          :current-page="page"
          :page-size="pageSize"
          :total="total"
          layout="total, prev, pager, next"
          @current-change="onPageChange"
        />
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.mine-page {
  max-width: 1000px;
  margin: 0 auto;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.tab-badge {
  margin-left: 4px;
  transform: translateY(-2px);
}

.product-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.thumb {
  width: 48px;
  height: 48px;
  border-radius: 4px;
  object-fit: cover;
  flex-shrink: 0;
}

.thumb.placeholder {
  background: var(--el-fill-color-light);
}

.p-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pagination {
  display: flex;
  justify-content: center;
  margin-top: 16px;
}
</style>
