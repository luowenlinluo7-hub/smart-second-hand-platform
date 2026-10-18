<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { ShoppingCart, WarningFilled } from '@element-plus/icons-vue'
import { createOrder } from '@/api/order'
import { getProduct } from '@/api/product'
import EmptyState from '@/components/EmptyState.vue'
import { useIsMobile } from '@/composables/useIsMobile'
import { useCartStore, type CartItem } from '@/stores/cart'

const route = useRoute()
const router = useRouter()
const cartStore = useCartStore()
const { isMobile } = useIsMobile()

const dialogVisible = ref(false)
const submitting = ref(false)
const formRef = ref<FormInstance>()

// ---------- 立即购买模式 ----------
// 商品详情页的「立即购买」会跳到 /cart?buyNow=<productId>。
// 该模式下只结算这一件商品，**既不读取也不清空购物车**，
// 避免把用户购物车里已有的商品一起下单。
const buyNowId = computed<string | null>(() => {
  const value = route.query.buyNow
  return typeof value === 'string' && value ? value : null
})

const buyNowItem = ref<CartItem | null>(null)
const buyNowLoading = ref(false)

const loadBuyNow = async (productId: string): Promise<void> => {
  buyNowLoading.value = true
  buyNowItem.value = null
  try {
    const product = await getProduct(productId)
    if (product.status !== 'ON_SALE') {
      ElMessage.warning('该商品已售出或已下架')
      return
    }
    buyNowItem.value = {
      productId: product.id,
      title: product.title,
      price: product.price,
      image: product.images?.[0] ?? null,
      sellerId: product.sellerId,
      sellerName: product.seller.nickname || product.seller.username,
      quantity: 1,
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '商品加载失败')
  } finally {
    buyNowLoading.value = false
  }
}

watch(
  buyNowId,
  (id) => {
    if (id) {
      void loadBuyNow(id)
      return
    }
    buyNowItem.value = null
  },
  { immediate: true },
)

// 本次要结算的条目：立即购买模式只有一件，普通模式是整车
const checkoutItems = computed<CartItem[]>(() =>
  buyNowId.value ? (buyNowItem.value ? [buyNowItem.value] : []) : cartStore.items,
)

const checkoutAmount = computed<string>(() =>
  checkoutItems.value.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0).toFixed(2),
)

// 展示用分组：立即购买模式也要按卖家分组，模板结构与普通模式保持一致
const displayGroups = computed(() => {
  const groups = new Map<string, { sellerId: string; sellerName: string; items: CartItem[] }>()
  for (const item of checkoutItems.value) {
    const group = groups.get(item.sellerId) ?? {
      sellerId: item.sellerId,
      sellerName: item.sellerName,
      items: [],
    }
    group.items.push(item)
    groups.set(item.sellerId, group)
  }
  return [...groups.values()]
})

const form = reactive({
  receiverName: '',
  receiverPhone: '',
  receiverAddress: '',
  remark: '',
})

const rules: FormRules = {
  receiverName: [{ required: true, message: '请填写收货人', trigger: 'blur' }],
  receiverPhone: [
    { required: true, message: '请填写手机号', trigger: 'blur' },
    { pattern: /^1[3-9]\d{9}$/, message: '手机号格式不正确', trigger: 'blur' },
  ],
  receiverAddress: [{ required: true, message: '请填写收货地址', trigger: 'blur' }],
}

const onRemove = (productId: string): void => {
  cartStore.remove(productId)
}

// 打开结算弹窗
const openCheckout = (): void => {
  if (checkoutItems.value.length === 0) {
    ElMessage.warning('没有可结算的商品')
    return
  }
  dialogVisible.value = true
}

// 提交订单：按卖家拆单由后端完成
const onSubmit = async (): Promise<void> => {
  if (!formRef.value) return
  const valid = await formRef.value.validate().then(() => true).catch(() => false)
  if (!valid) return
  if (checkoutItems.value.length === 0) {
    ElMessage.warning('没有可结算的商品')
    return
  }

  submitting.value = true
  try {
    const orders = await createOrder({
      items: checkoutItems.value.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
      })),
      receiverName: form.receiverName,
      receiverPhone: form.receiverPhone,
      receiverAddress: form.receiverAddress,
      remark: form.remark || undefined,
    })
    // 立即购买不动购物车；普通结算才整车清空
    if (!buyNowId.value) {
      cartStore.clear()
    }
    dialogVisible.value = false
    ElMessage.success(`下单成功，共生成 ${orders.length} 个订单`)
    router.push('/orders')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '下单失败')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="cart-page">
    <el-card v-loading="buyNowLoading" shadow="never">
      <template #header>
        <div class="card-header">
          <span v-if="buyNowId">立即购买</span>
          <span v-else>购物车（{{ cartStore.totalCount }} 件）</span>
          <el-button
            v-if="!buyNowId && cartStore.items.length"
            text
            type="danger"
            @click="cartStore.clear()"
          >
            清空购物车
          </el-button>
        </div>
      </template>

      <!-- 立即购买模式下商品不可购买（已售出 / 已下架 / 加载失败） -->
      <EmptyState
        v-if="buyNowId && !buyNowLoading && !buyNowItem"
        :icon="WarningFilled"
        title="该商品暂时无法购买"
        description="可能已被他人买走或卖家下架，看看其它同类商品？"
        action-text="返回商品页"
        @action="router.back()"
      />

      <EmptyState
        v-else-if="!buyNowId && cartStore.items.length === 0"
        :icon="ShoppingCart"
        title="购物车是空的"
        description="挑几件心仪的好物放进来，一次性结算更省事"
        action-text="去挑选商品"
        @action="router.push('/')"
      />

      <template v-else>
        <!-- 按卖家分组展示（下单后端会按卖家拆单） -->
        <div v-for="group in displayGroups" :key="group.sellerId" class="seller-group">
          <div class="seller-title">卖家：{{ group.sellerName }}</div>
          <div v-for="item in group.items" :key="item.productId" class="cart-item">
            <img v-if="item.image" :src="item.image" class="thumb" alt="商品图" />
            <div v-else class="thumb placeholder" />
            <div class="info">
              <div class="title">{{ item.title }}</div>
              <div class="price">¥{{ item.price }}</div>
            </div>
            <div class="qty">×{{ item.quantity }}</div>
            <div class="subtotal">¥{{ (Number(item.price) * item.quantity).toFixed(2) }}</div>
            <el-button v-if="!buyNowId" text type="danger" @click="onRemove(item.productId)">
              移除
            </el-button>
          </div>
        </div>

        <div class="footer">
          <div class="total">
            合计：<span class="total-amount">¥{{ checkoutAmount }}</span>
          </div>
          <el-button type="primary" size="large" @click="openCheckout">去结算</el-button>
        </div>
      </template>
    </el-card>

    <!-- 结算弹窗：填写收货信息 -->
    <el-dialog v-model="dialogVisible" title="填写收货信息" width="480px">
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        :label-position="isMobile ? 'top' : 'right'"
        :label-width="isMobile ? 'auto' : '90px'"
      >
        <el-form-item label="收货人" prop="receiverName">
          <el-input v-model="form.receiverName" placeholder="收货人姓名" />
        </el-form-item>
        <el-form-item label="手机号" prop="receiverPhone">
          <el-input v-model="form.receiverPhone" placeholder="11 位手机号" />
        </el-form-item>
        <el-form-item label="收货地址" prop="receiverAddress">
          <el-input v-model="form.receiverAddress" type="textarea" :rows="2" placeholder="省市区 + 详细地址" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" placeholder="选填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="onSubmit">
          提交订单（¥{{ checkoutAmount }}）
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.cart-page {
  max-width: 900px;
  margin: 0 auto;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.seller-group {
  margin-bottom: 16px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 4px;
  padding: 12px;
}

.seller-title {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-bottom: 8px;
}

.cart-item {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) 0;
  border-top: 1px solid var(--el-border-color-lighter);
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

.info {
  flex: 1;
  min-width: 0;
}

.title {
  font-size: 14px;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.price {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}

.qty {
  width: 48px;
  color: var(--el-text-color-regular);
}

.subtotal {
  width: 100px;
  text-align: right;
  color: var(--price-color);
  font-weight: 600;
}

.footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-2);
  padding-top: var(--space-2);
  border-top: 1px solid var(--el-border-color-light);
}

.total-amount {
  color: var(--price-color);
  font-size: 20px;
  font-weight: 700;
}

/* ---------- 移动端 ---------- */
@media (max-width: 767px) {
  /* 单行放不下缩略图 + 标题 + 数量 + 小计 + 移除，
     改成两行网格：第一行图/标题/移除，第二行数量与小计 */
  .cart-item {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-areas:
      'thumb info remove'
      'thumb qty subtotal';
    column-gap: var(--space-1);
    row-gap: var(--space-1);
    align-items: center;
  }

  .thumb {
    grid-area: thumb;
    align-self: start;
  }

  .info {
    grid-area: info;
  }

  .qty {
    grid-area: qty;
    width: auto;
  }

  .subtotal {
    grid-area: subtotal;
    width: auto;
  }

  .cart-item .el-button {
    grid-area: remove;
  }

  .footer {
    flex-wrap: wrap;
    justify-content: space-between;
  }
}
</style>
