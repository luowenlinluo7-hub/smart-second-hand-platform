<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getBuyerOrders, getSellerOrders, updateOrderStatus } from '@/api/order'
import { useAuthStore } from '@/stores/auth'
import type { Order, OrderStatus } from '@/types/api'

const router = useRouter()
const authStore = useAuthStore()

const role = ref<'buyer' | 'seller'>('buyer')
const status = ref<'' | OrderStatus>('')
const loading = ref(false)
const list = ref<Order[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(10)

const statusLabels: Record<OrderStatus, string> = {
  PENDING_PAYMENT: '待付款',
  PENDING_SHIPMENT: '待发货',
  SHIPPED: '已发货',
  COMPLETED: '已完成',
  REVIEWED: '已评价',
  CANCELLED: '已取消',
}

const statusTagTypes: Record<OrderStatus, 'info' | 'warning' | 'success' | 'danger' | 'primary'> = {
  PENDING_PAYMENT: 'danger',
  PENDING_SHIPMENT: 'warning',
  SHIPPED: 'primary',
  COMPLETED: 'success',
  REVIEWED: 'success',
  CANCELLED: 'info',
}

const statusOptions: { value: '' | OrderStatus; label: string }[] = [
  { value: '', label: '全部' },
  { value: 'PENDING_PAYMENT', label: '待付款' },
  { value: 'PENDING_SHIPMENT', label: '待发货' },
  { value: 'SHIPPED', label: '已发货' },
  { value: 'COMPLETED', label: '已完成' },
  { value: 'REVIEWED', label: '已评价' },
  { value: 'CANCELLED', label: '已取消' },
]

const fetchList = async (): Promise<void> => {
  loading.value = true
  try {
    const params = {
      status: status.value || undefined,
      page: page.value,
      pageSize: pageSize.value,
    }
    const result = role.value === 'buyer'
      ? await getBuyerOrders(params)
      : await getSellerOrders(params)
    list.value = result.list
    total.value = result.total
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '加载失败')
  } finally {
    loading.value = false
  }
}

const onRoleChange = (): void => {
  page.value = 1
  fetchList()
}

const onFilter = (): void => {
  page.value = 1
  fetchList()
}

const onPageChange = (p: number): void => {
  page.value = p
  fetchList()
}

// 状态流转：不同角色在不同状态下可执行的操作不同
const doTransition = async (order: Order, target: OrderStatus, confirmText: string): Promise<void> => {
  try {
    await ElMessageBox.confirm(confirmText, '确认操作', { type: 'warning' })
    await updateOrderStatus(order.id, target)
    ElMessage.success('操作成功')
    fetchList()
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error(error instanceof Error ? error.message : '操作失败')
    }
  }
}

const goDetail = (id: string): void => {
  router.push(`/orders/${id}`)
}

// 当前用户对该订单可执行的操作（与后端状态机保持一致）
const actionsOf = (order: Order): { label: string; type: 'primary' | 'success' | 'info' | 'danger'; run: () => void }[] => {
  const isBuyer = order.buyerId === authStore.user?.id
  const isSeller = order.sellerId === authStore.user?.id
  const actions: { label: string; type: 'primary' | 'success' | 'info' | 'danger'; run: () => void }[] = []

  if (isBuyer && order.status === 'PENDING_PAYMENT') {
    actions.push({
      label: '去付款',
      type: 'primary',
      run: () => doTransition(order, 'PENDING_SHIPMENT', `确认支付 ¥${order.totalAmount}？（模拟支付，二手平台无真实支付）`),
    })
    actions.push({
      label: '取消订单',
      type: 'danger',
      run: () => doTransition(order, 'CANCELLED', '确认取消该订单？取消后商品会重新上架'),
    })
  }
  if (isSeller && order.status === 'PENDING_SHIPMENT') {
    actions.push({
      label: '发货',
      type: 'primary',
      run: () => doTransition(order, 'SHIPPED', '确认已发货？'),
    })
  }
  if (isBuyer && order.status === 'SHIPPED') {
    actions.push({
      label: '确认收货',
      type: 'success',
      run: () => doTransition(order, 'COMPLETED', '确认已收到货？'),
    })
  }
  if (isBuyer && order.status === 'COMPLETED') {
    actions.push({ label: '去评价', type: 'primary', run: () => goDetail(order.id) })
  }
  return actions
}

const counterparty = (order: Order): string => {
  const user = role.value === 'buyer' ? order.seller : order.buyer
  return user.nickname || user.username
}

const isSellerRole = computed(() => authStore.user?.role === 'SELLER')

onMounted(() => {
  // 买家视角为默认；若用户是卖家也可切到卖出
  fetchList()
})
</script>

<template>
  <div class="order-page">
    <el-card shadow="never">
      <template #header>
        <div class="card-header">
          <span>我的订单</span>
          <el-radio-group v-model="role" size="small" @change="onRoleChange">
            <el-radio-button value="buyer">我买到的</el-radio-button>
            <el-radio-button value="seller" :disabled="!isSellerRole">我卖出的</el-radio-button>
          </el-radio-group>
        </div>
      </template>

      <div class="filter-bar">
        <el-radio-group v-model="status" size="small" @change="onFilter">
          <el-radio-button v-for="opt in statusOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </el-radio-button>
        </el-radio-group>
      </div>

      <div v-loading="loading">
        <el-empty v-if="!loading && list.length === 0" description="暂无订单" />

        <div v-for="order in list" :key="order.id" class="order-item">
          <div class="order-head">
            <span class="order-no">订单号：{{ order.orderNo }}</span>
            <span class="counterparty">{{ role === 'buyer' ? '卖家' : '买家' }}：{{ counterparty(order) }}</span>
            <el-tag :type="statusTagTypes[order.status]" size="small">
              {{ statusLabels[order.status] }}
            </el-tag>
          </div>

          <div class="order-body" @click="goDetail(order.id)">
            <div v-for="item in order.items" :key="item.id" class="order-goods">
              <img v-if="item.image" :src="item.image" class="thumb" alt="商品图" />
              <div v-else class="thumb placeholder" />
              <div class="goods-info">
                <div class="goods-title">{{ item.title }}</div>
                <div class="goods-price">¥{{ item.price }} × {{ item.quantity }}</div>
              </div>
            </div>
          </div>

          <div class="order-foot">
            <span class="total">合计：<span class="amount">¥{{ order.totalAmount }}</span></span>
            <div class="actions">
              <el-button size="small" @click="goDetail(order.id)">详情</el-button>
              <el-button
                v-for="action in actionsOf(order)"
                :key="action.label"
                size="small"
                :type="action.type"
                @click="action.run()"
              >
                {{ action.label }}
              </el-button>
            </div>
          </div>
        </div>
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
.order-page {
  max-width: 960px;
  margin: 0 auto;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.filter-bar {
  margin-bottom: 12px;
}

.order-item {
  border: 1px solid var(--el-border-color-light);
  border-radius: 4px;
  padding: 12px;
  margin-bottom: 12px;
}

.order-head {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 13px;
  color: #909399;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.order-no {
  color: #303133;
}

.counterparty {
  flex: 1;
}

.order-body {
  padding: 8px 0;
  cursor: pointer;
}

.order-goods {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
}

.thumb {
  width: 48px;
  height: 48px;
  border-radius: 4px;
  object-fit: cover;
  flex-shrink: 0;
}

.thumb.placeholder {
  background: #f5f7fa;
}

.goods-title {
  font-size: 14px;
  color: #303133;
}

.goods-price {
  font-size: 12px;
  color: #909399;
  margin-top: 2px;
}

.order-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 8px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.amount {
  color: var(--el-color-danger);
  font-size: 18px;
  font-weight: 700;
}

.actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.pagination {
  display: flex;
  justify-content: center;
  margin-top: 16px;
}
</style>
