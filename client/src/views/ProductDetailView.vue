<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { getProduct } from '@/api/product'
import { useAiChatStore } from '@/stores/aiChat'
import { useAuthStore } from '@/stores/auth'
import { useCartStore } from '@/stores/cart'
import { CONDITION_LABEL } from '@/constants/status'
import type { Product } from '@/types/api'

const route = useRoute()
const router = useRouter()
const aiChat = useAiChatStore()
const authStore = useAuthStore()
const cartStore = useCartStore()

const loading = ref(false)
const product = ref<Product | null>(null)

// 加入购物车前的统一校验
const ensureBuyable = (): boolean => {
  if (!product.value) return false
  if (!authStore.isLoggedIn) {
    ElMessage.warning('请先登录')
    router.push({ path: '/login', query: { redirect: route.fullPath } })
    return false
  }
  if (product.value.status !== 'ON_SALE') {
    ElMessage.warning('该商品已售出或已下架')
    return false
  }
  if (product.value.sellerId === authStore.user?.id) {
    ElMessage.warning('不能购买自己发布的商品')
    return false
  }
  return true
}

const toCartItem = (p: Product) => ({
  productId: p.id,
  title: p.title,
  price: p.price,
  image: p.images?.[0] ?? null,
  sellerId: p.sellerId,
  sellerName: p.seller.nickname || p.seller.username,
})

const addToCart = (): void => {
  if (!ensureBuyable() || !product.value) return
  cartStore.add(toCartItem(product.value))
  ElMessage.success('已加入购物车')
}

// 立即购买：加入购物车后直接去结算
const buyNow = (): void => {
  if (!ensureBuyable() || !product.value) return
  cartStore.add(toCartItem(product.value))
  router.push('/cart')
}

// 打开 AI 助手并让它知道用户正在看这件商品，
// 这样「这件成色怎么样」里的「这件」才能被正确消解
const askAi = (): void => {
  aiChat.open()
}

onMounted(async () => {
  loading.value = true
  // 先把关注商品告诉助手，用户此时问「这件成色怎么样」才有意义
  aiChat.setFocusProduct(String(route.params.id))
  try {
    product.value = await getProduct(String(route.params.id))
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '加载失败')
  } finally {
    loading.value = false
  }
})

// 离开详情页就清掉关注点，避免在别的页面问「这件」时指向已经过期的商品
onUnmounted(() => {
  aiChat.setFocusProduct(null)
})
</script>

<template>
  <div v-loading="loading" class="detail-page">
    <template v-if="product">
      <el-card shadow="never" class="detail-card">
        <el-row :gutter="24">
          <!-- 左侧轮播图 -->
          <el-col :xs="24" :md="10">
            <el-carousel v-if="product.images && product.images.length" height="320px" indicator-position="outside">
              <el-carousel-item v-for="(img, i) in product.images" :key="i">
                <img :src="img" class="carousel-img" alt="商品图" />
              </el-carousel-item>
            </el-carousel>
            <div v-else class="no-image">暂无图片</div>
          </el-col>

          <!-- 右侧信息 -->
          <el-col :xs="24" :md="14">
            <h2 class="title">{{ product.title }}</h2>
            <div class="price-row">
              <span class="price">¥{{ product.price }}</span>
              <span v-if="product.originalPrice" class="original">原价 ¥{{ product.originalPrice }}</span>
            </div>
            <el-descriptions :column="2" class="info" border>
              <el-descriptions-item label="成色">
                {{ CONDITION_LABEL[product.condition] }}
              </el-descriptions-item>
              <el-descriptions-item label="分类">{{ product.category.name }}</el-descriptions-item>
              <el-descriptions-item label="库存">{{ product.stock }}</el-descriptions-item>
              <el-descriptions-item label="浏览">{{ product.viewCount }}</el-descriptions-item>
              <el-descriptions-item label="卖家">
                {{ product.seller.nickname || product.seller.username }}
              </el-descriptions-item>
              <el-descriptions-item label="发布时间">
                {{ product.publishedAt ? product.publishedAt.slice(0, 10) : '-' }}
              </el-descriptions-item>
            </el-descriptions>

            <el-divider content-position="left">商品描述</el-divider>
            <p class="description">{{ product.description || '卖家很懒，什么都没写~' }}</p>

            <div class="actions">
              <el-button @click="router.back()">返回</el-button>
              <el-button
                v-if="product.status === 'ON_SALE'"
                :type="cartStore.has(product.id) ? 'default' : 'warning'"
                :disabled="cartStore.has(product.id)"
                @click="addToCart"
              >
                {{ cartStore.has(product.id) ? '已在购物车' : '加入购物车' }}
              </el-button>
              <el-button v-if="product.status === 'ON_SALE'" type="primary" @click="buyNow">
                立即购买
              </el-button>
              <el-tag v-else type="info" size="large">该商品已售出或已下架</el-tag>
              <el-button plain @click="askAi">问 AI 这件商品的细节</el-button>
            </div>
          </el-col>
        </el-row>
      </el-card>
    </template>
  </div>
</template>

<style scoped>
.detail-page {
  max-width: 1000px;
  margin: 0 auto;
}

.carousel-img {
  width: 100%;
  height: 320px;
  object-fit: cover;
}

.no-image {
  height: 320px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-placeholder);
}

.title {
  margin: 0 0 16px;
  font-size: 22px;
  color: var(--el-text-color-primary);
}

.price-row {
  margin-bottom: 16px;
}

.price {
  color: var(--el-color-danger);
  font-size: 28px;
  font-weight: 700;
}

.original {
  margin-left: 12px;
  color: var(--el-text-color-placeholder);
  text-decoration: line-through;
}

.info {
  margin-bottom: 8px;
}

.description {
  color: var(--el-text-color-regular);
  line-height: 1.8;
  white-space: pre-wrap;
}

.actions {
  margin-top: 24px;
}
</style>
