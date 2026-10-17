<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { auditProduct, getAuditProducts } from '@/api/admin'
import { useIsMobile } from '@/composables/useIsMobile'
import type { Product } from '@/types/api'

const { isMobile } = useIsMobile()

const loading = ref(false)
const list = ref<Product[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)

const fetchList = async (): Promise<void> => {
  loading.value = true
  try {
    const result = await getAuditProducts({
      status: 'PENDING_REVIEW',
      page: page.value,
      pageSize: pageSize.value,
    })
    list.value = result.list
    total.value = result.total
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '加载失败')
  } finally {
    loading.value = false
  }
}

const onPageChange = (p: number): void => {
  page.value = p
  fetchList()
}

// 审核通过
const onApprove = async (p: Product): Promise<void> => {
  try {
    await ElMessageBox.confirm(`确定通过「${p.title}」的审核并上架吗？`, '审核通过', {
      type: 'warning',
      confirmButtonText: '通过',
      cancelButtonText: '取消',
    })
    await auditProduct(p.id, { approve: true })
    ElMessage.success('已通过并上架')
    fetchList()
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error(error instanceof Error ? error.message : '操作失败')
    }
  }
}

// 审核驳回：弹窗填原因
const onReject = async (p: Product): Promise<void> => {
  try {
    const { value } = await ElMessageBox.prompt(`请输入驳回「${p.title}」的原因`, '审核驳回', {
      confirmButtonText: '驳回',
      cancelButtonText: '取消',
      inputType: 'textarea',
      inputPlaceholder: '如：图片模糊、描述不实、价格异常等',
      inputValidator: (v: string) => (v && v.trim() ? true : '驳回原因不能为空'),
    })
    await auditProduct(p.id, { approve: false, rejectReason: value.trim() })
    ElMessage.success('已驳回')
    fetchList()
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error(error instanceof Error ? error.message : '操作失败')
    }
  }
}

onMounted(fetchList)
</script>

<template>
  <div class="review-page">
    <el-card shadow="never">
      <template #header>
        <span>商品审核（待审核）</span>
      </template>

      <div v-loading="loading">
        <el-empty v-if="!loading && list.length === 0" description="暂无待审核商品" />

        <el-table v-else :data="list" style="width: 100%">
          <el-table-column label="商品" min-width="280">
            <template #default="{ row }: { row: Product }">
              <div class="product-cell">
                <img v-if="row.images && row.images.length" :src="row.images[0]" class="thumb" alt="封面" />
                <div v-else class="thumb placeholder" />
                <div>
                  <div class="p-title">{{ row.title }}</div>
                  <div class="p-desc">{{ row.description || '无描述' }}</div>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="价格" width="100">
            <template #default="{ row }: { row: Product }">¥{{ row.price }}</template>
          </el-table-column>
          <el-table-column label="卖家" width="120">
            <template #default="{ row }: { row: Product }">
              {{ row.seller.nickname || row.seller.username }}
            </template>
          </el-table-column>
          <el-table-column label="分类" width="100" prop="category.name" />
          <el-table-column label="操作" :width="180" :fixed="isMobile ? false : 'right'">
            <template #default="{ row }: { row: Product }">
              <el-button size="small" type="success" @click="onApprove(row)">通过</el-button>
              <el-button size="small" type="danger" @click="onReject(row)">驳回</el-button>
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
.review-page {
  max-width: 1000px;
  margin: 0 auto;
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
  font-weight: 500;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 220px;
}

.p-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 220px;
}

.pagination {
  display: flex;
  justify-content: center;
  margin-top: 16px;
}
</style>
