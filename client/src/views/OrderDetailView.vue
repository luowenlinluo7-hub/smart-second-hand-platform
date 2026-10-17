<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createReviews, getOrder, updateOrderStatus } from '@/api/order'
import { ORDER_STATUS_LABEL } from '@/constants/status'
import UserAvatar from '@/components/UserAvatar.vue'
import { useIsMobile } from '@/composables/useIsMobile'
import { useAuthStore } from '@/stores/auth'
import type { Order, OrderStatus } from '@/types/api'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const { isMobile } = useIsMobile()

const loading = ref(false)
const submitting = ref(false)
const order = ref<Order | null>(null)

// 评价表单：每个商品一条
const reviewForm = reactive<Record<string, { rating: number; content: string }>>({})

const statusSteps: { key: OrderStatus; label: string }[] = [
  { key: 'PENDING_PAYMENT', label: ORDER_STATUS_LABEL.PENDING_PAYMENT },
  { key: 'PENDING_SHIPMENT', label: ORDER_STATUS_LABEL.PENDING_SHIPMENT },
  { key: 'SHIPPED', label: ORDER_STATUS_LABEL.SHIPPED },
  { key: 'COMPLETED', label: ORDER_STATUS_LABEL.COMPLETED },
  { key: 'REVIEWED', label: ORDER_STATUS_LABEL.REVIEWED },
]

// 当前进度（取消的订单时间线不适用）
const activeStep = computed(() => {
  if (!order.value) return 0
  const idx = statusSteps.findIndex((s) => s.key === order.value?.status)
  return idx < 0 ? 0 : idx
})

const isBuyer = computed(() => order.value?.buyerId === authStore.user?.id)
const isSeller = computed(() => order.value?.sellerId === authStore.user?.id)

const fetchOrder = async (): Promise<void> => {
  loading.value = true
  try {
    const data = await getOrder(String(route.params.id))
    order.value = data
    // 初始化评价表单
    for (const item of data.items) {
      reviewForm[item.productId] = { rating: 5, content: '' }
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '加载失败')
    router.push('/orders')
  } finally {
    loading.value = false
  }
}

const doTransition = async (target: OrderStatus, confirmText: string): Promise<void> => {
  if (!order.value) return
  try {
    await ElMessageBox.confirm(confirmText, '确认操作', { type: 'warning' })
    await updateOrderStatus(order.value.id, target)
    ElMessage.success('操作成功')
    fetchOrder()
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') {
      ElMessage.error(error instanceof Error ? error.message : '操作失败')
    }
  }
}

// 提交评价：为订单内每个商品各建一条
const onSubmitReviews = async (): Promise<void> => {
  if (!order.value) return
  submitting.value = true
  try {
    const reviews = order.value.items.map((item) => ({
      productId: item.productId,
      rating: reviewForm[item.productId]?.rating ?? 5,
      content: reviewForm[item.productId]?.content || undefined,
    }))
    await createReviews(order.value.id, reviews)
    ElMessage.success('评价成功')
    fetchOrder()
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '评价失败')
  } finally {
    submitting.value = false
  }
}

onMounted(fetchOrder)
</script>

<template>
  <div v-loading="loading" class="detail-page">
    <template v-if="order">
      <el-card shadow="never" class="mb">
        <template #header>
          <div class="head">
            <span>订单号：{{ order.orderNo }}</span>
            <el-tag :type="order.status === 'CANCELLED' ? 'info' : 'success'">
              {{ ORDER_STATUS_LABEL[order.status] }}
            </el-tag>
          </div>
        </template>

        <el-steps
          v-if="order.status !== 'CANCELLED'"
          :active="activeStep"
          :direction="isMobile ? 'vertical' : 'horizontal'"
          :align-center="!isMobile"
          finish-status="success"
        >
          <el-step v-for="s in statusSteps" :key="s.key" :title="s.label" />
        </el-steps>
        <el-alert v-else type="info" :closable="false" title="该订单已取消，商品已重新上架" />

        <div class="meta">
          <span class="party">
            <UserAvatar
              :src="order.buyer.avatar"
              :name="order.buyer.nickname || order.buyer.username"
              :size="22"
            />
            买家：{{ order.buyer.nickname || order.buyer.username }}
          </span>
          <span class="party">
            <UserAvatar
              :src="order.seller.avatar"
              :name="order.seller.nickname || order.seller.username"
              :size="22"
            />
            卖家：{{ order.seller.nickname || order.seller.username }}
          </span>
          <span>下单时间：{{ order.createdAt.slice(0, 19).replace('T', ' ') }}</span>
        </div>
      </el-card>

      <!-- 商品快照 -->
      <el-card shadow="never" class="mb">
        <template #header><span>商品信息</span></template>
        <div v-for="item in order.items" :key="item.id" class="goods">
          <img v-if="item.image" :src="item.image" class="thumb" alt="商品图" />
          <div v-else class="thumb placeholder" />
          <div class="goods-info">
            <div class="goods-title">{{ item.title }}</div>
            <div class="goods-sub">单价 ¥{{ item.price }} × {{ item.quantity }}</div>
          </div>
          <div class="goods-subtotal">¥{{ item.subtotal }}</div>
        </div>
        <div class="total-row">
          订单总额：<span class="amount">¥{{ order.totalAmount }}</span>
        </div>
      </el-card>

      <!-- 收货信息 -->
      <el-card shadow="never" class="mb">
        <template #header><span>收货信息</span></template>
        <el-descriptions :column="1" border>
          <el-descriptions-item label="收货人">{{ order.receiverName }}</el-descriptions-item>
          <el-descriptions-item label="手机号">{{ order.receiverPhone }}</el-descriptions-item>
          <el-descriptions-item label="收货地址">{{ order.receiverAddress }}</el-descriptions-item>
          <el-descriptions-item label="买家备注">{{ order.remark || '无' }}</el-descriptions-item>
        </el-descriptions>
      </el-card>

      <!-- 评价：订单已完成且当前用户是买家 -->
      <el-card v-if="isBuyer && order.status === 'COMPLETED'" shadow="never" class="mb">
        <template #header><span>评价商品</span></template>
        <div v-for="item in order.items" :key="item.id" class="review-row">
          <div class="review-title">{{ item.title }}</div>
          <el-rate v-model="reviewForm[item.productId].rating" />
          <el-input
            v-model="reviewForm[item.productId].content"
            type="textarea"
            :rows="2"
            placeholder="说说你的使用感受（选填）"
            maxlength="500"
            show-word-limit
          />
        </div>
        <el-button type="primary" :loading="submitting" @click="onSubmitReviews">提交评价</el-button>
      </el-card>

      <!-- 操作按钮 -->
      <div class="actions">
        <el-button @click="router.push('/orders')">返回列表</el-button>

        <template v-if="isBuyer && order.status === 'PENDING_PAYMENT'">
          <el-button
            type="danger"
            @click="doTransition('CANCELLED', '确认取消该订单？取消后商品会重新上架')"
          >
            取消订单
          </el-button>
          <el-button
            type="primary"
            @click="doTransition('PENDING_SHIPMENT', `确认支付 ¥${order.totalAmount}？（模拟支付）`)"
          >
            去付款
          </el-button>
        </template>

        <el-button
          v-if="isSeller && order.status === 'PENDING_SHIPMENT'"
          type="primary"
          @click="doTransition('SHIPPED', '确认已发货？')"
        >
          发货
        </el-button>

        <el-button
          v-if="isBuyer && order.status === 'SHIPPED'"
          type="success"
          @click="doTransition('COMPLETED', '确认已收到货？')"
        >
          确认收货
        </el-button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.detail-page {
  max-width: 900px;
  margin: 0 auto;
}

.mb {
  margin-bottom: 16px;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.meta {
  display: flex;
  gap: 24px;
  margin-top: 16px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  flex-wrap: wrap;
}
.party {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

.goods {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.thumb {
  width: 56px;
  height: 56px;
  border-radius: 4px;
  object-fit: cover;
  flex-shrink: 0;
}

.thumb.placeholder {
  background: var(--el-fill-color-light);
}

.goods-info {
  flex: 1;
  min-width: 0;
}

.goods-title {
  font-size: 14px;
  color: var(--el-text-color-primary);
}

.goods-sub {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}

.goods-subtotal {
  color: var(--el-color-danger);
  font-weight: 600;
}

.total-row {
  text-align: right;
  margin-top: 12px;
  color: var(--el-text-color-regular);
}

.amount {
  color: var(--el-color-danger);
  font-size: 20px;
  font-weight: 700;
}

.review-row {
  margin-bottom: 16px;
}

.review-title {
  font-size: 14px;
  color: var(--el-text-color-primary);
  margin-bottom: 6px;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
