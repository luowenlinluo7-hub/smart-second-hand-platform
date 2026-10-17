<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { getProduct, getProductReviews } from '@/api/product'
import { getUserProfile } from '@/api/user'
import UserAvatar from '@/components/UserAvatar.vue'
import { useAiChatStore } from '@/stores/aiChat'
import { useAuthStore } from '@/stores/auth'
import { useCartStore } from '@/stores/cart'
import { CONDITION_LABEL } from '@/constants/status'
import type { Product, ProductReview, ReviewSummary, SellerProfile } from '@/types/api'

const route = useRoute()
const router = useRouter()
const aiChat = useAiChatStore()
const authStore = useAuthStore()
const cartStore = useCartStore()

const loading = ref(false)
const product = ref<Product | null>(null)

// 卖家信息卡：seller 负责统计数字，头像/昵称先用商品自带的兜底
const seller = ref<SellerProfile | null>(null)

// 商品评价
const reviews = ref<ProductReview[]>([])
const reviewSummary = ref<ReviewSummary | null>(null)
const reviewTotal = ref(0)
const reviewPage = ref(1)
const reviewPageSize = 5
const reviewLoading = ref(false)

const sellerName = computed<string>(() => {
  const s = seller.value ?? product.value?.seller
  if (!s) return ''
  return s.nickname || s.username
})

// 头像优先取统计接口的（更新），回退到商品里嵌套的卖家信息
const sellerAvatar = computed<string | null>(
  () => seller.value?.avatar ?? product.value?.seller.avatar ?? null,
)

const formatDate = (iso: string): string => {
  const d = new Date(iso)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// 某星级占比（0~100），用于分布条
const starPercent = (star: number): number => {
  const summary = reviewSummary.value
  if (!summary || summary.count === 0) return 0
  const key = String(star) as keyof ReviewSummary['distribution']
  return Math.round((summary.distribution[key] / summary.count) * 100)
}

const starCount = (star: number): number => {
  const summary = reviewSummary.value
  if (!summary) return 0
  const key = String(star) as keyof ReviewSummary['distribution']
  return summary.distribution[key]
}

const loadReviews = async (targetPage: number): Promise<void> => {
  if (!product.value) return
  reviewLoading.value = true
  try {
    const result = await getProductReviews(product.value.id, {
      page: targetPage,
      pageSize: reviewPageSize,
    })
    reviews.value = result.list
    reviewTotal.value = result.total
    reviewSummary.value = result.summary
    reviewPage.value = result.page
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '评价加载失败')
  } finally {
    reviewLoading.value = false
  }
}

const onReviewPageChange = (page: number): void => {
  void loadReviews(page)
}

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

    // 卖家统计与评价并行拉取：任一失败都不应影响商品主体展示
    void getUserProfile(product.value.sellerId)
      .then((profile) => {
        seller.value = profile
      })
      .catch(() => {
        seller.value = null
      })
    void loadReviews(1)
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

      <!-- 卖家信息卡：二手交易的核心信任来源 -->
      <el-card shadow="never" class="section-card">
        <div class="seller-card">
          <UserAvatar :src="sellerAvatar" :name="sellerName" :size="52" />
          <div class="seller-meta">
            <div class="seller-name">{{ sellerName }}</div>
            <div class="seller-sub">
              <template v-if="seller">
                在售 {{ seller.stats.onSaleCount }} 件 · 历史成交 {{ seller.stats.soldCount }} 件
              </template>
              <template v-else>卖家信息加载中…</template>
            </div>
          </div>
          <div class="seller-score">
            <template v-if="seller && seller.stats.avgRating !== null">
              <span class="score-num">{{ seller.stats.avgRating.toFixed(1) }}</span>
              <span class="score-desc">
                <el-rate :model-value="seller.stats.avgRating" disabled allow-half size="small" />
                {{ seller.stats.reviewCount }} 条评价
              </span>
            </template>
            <span v-else class="score-desc">暂无卖家评价</span>
          </div>
        </div>
      </el-card>

      <!-- 商品评价 -->
      <el-card shadow="never" class="section-card">
        <template #header>
          <div class="section-head">
            <span class="section-title">商品评价</span>
            <span v-if="reviewSummary && reviewSummary.count > 0" class="section-sub">
              共 {{ reviewSummary.count }} 条
            </span>
          </div>
        </template>

        <div v-loading="reviewLoading" class="review-wrap">
          <el-empty v-if="!reviewLoading && reviewTotal === 0" description="该商品还没有评价" />

          <template v-else>
            <!-- 评分概览：平均分 + 星级分布 -->
            <div v-if="reviewSummary" class="review-summary">
              <div class="summary-score">
                <span class="summary-num">{{ reviewSummary.avgRating?.toFixed(1) ?? '—' }}</span>
                <el-rate
                  :model-value="reviewSummary.avgRating ?? 0"
                  disabled
                  allow-half
                  class="summary-rate"
                />
                <span class="summary-label">综合评分</span>
              </div>
              <div class="summary-dist">
                <div v-for="star in [5, 4, 3, 2, 1]" :key="star" class="dist-row">
                  <span class="dist-star">{{ star }} 星</span>
                  <el-progress
                    :percentage="starPercent(star)"
                    :show-text="false"
                    :stroke-width="6"
                    class="dist-bar"
                  />
                  <span class="dist-count">{{ starCount(star) }}</span>
                </div>
              </div>
            </div>

            <!-- 评价列表 -->
            <div class="review-list">
              <div v-for="item in reviews" :key="item.id" class="review-item">
                <UserAvatar
                  :src="item.reviewer.avatar"
                  :name="item.reviewer.nickname || item.reviewer.username"
                  :size="36"
                />
                <div class="review-main">
                  <div class="review-top">
                    <span class="review-user">
                      {{ item.reviewer.nickname || item.reviewer.username }}
                    </span>
                    <el-rate :model-value="item.rating" disabled />
                    <span class="review-time">{{ formatDate(item.createdAt) }}</span>
                  </div>
                  <p class="review-text">{{ item.content || '该用户没有填写评价内容' }}</p>
                  <div v-if="item.images && item.images.length" class="review-images">
                    <el-image
                      v-for="(img, i) in item.images"
                      :key="i"
                      :src="img"
                      :preview-src-list="item.images"
                      :initial-index="i"
                      fit="cover"
                      class="review-img"
                      preview-teleported
                    />
                  </div>
                </div>
              </div>
            </div>

            <div v-if="reviewTotal > reviewPageSize" class="review-pager">
              <el-pagination
                small
                layout="prev, pager, next"
                :current-page="reviewPage"
                :page-size="reviewPageSize"
                :total="reviewTotal"
                @current-change="onReviewPageChange"
              />
            </div>
          </template>
        </div>
      </el-card>
    </template>
  </div>
</template>

<style scoped>
.detail-page {
  max-width: 1000px;
  margin: 0 auto;
}

/* 详情页下方各区块的统一样式：12px 圆角 + 微阴影 */
.section-card {
  margin-top: var(--space-2);
  border-radius: 12px;
  box-shadow: var(--el-box-shadow-light);
}

.section-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-1);
}

.section-title {
  font-family: var(--font-title);
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.section-sub {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

/* ---------- 卖家信息卡 ---------- */
.seller-card {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.seller-meta {
  flex: 1;
  min-width: 0;
}

.seller-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.seller-sub {
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.seller-score {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex: 0 0 auto;
}

.seller-score .score-num {
  font-family: var(--font-title);
  font-size: 26px;
  font-weight: 700;
  color: var(--el-color-primary);
  line-height: 1;
}

.score-desc {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

/* ---------- 评价区 ---------- */
.review-wrap {
  min-height: 80px;
}

.review-summary {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  padding-bottom: var(--space-2);
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.summary-score {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  min-width: 120px;
}

.summary-num {
  font-family: var(--font-title);
  font-size: 34px;
  font-weight: 700;
  color: var(--el-color-primary);
  line-height: 1.1;
}

.summary-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.summary-dist {
  flex: 1;
  min-width: 0;
}

.dist-row {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  width: 100%;
}

.dist-star {
  flex: 0 0 36px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.dist-bar {
  flex: 1;
  min-width: 0;
}

.dist-count {
  flex: 0 0 28px;
  text-align: right;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.review-list {
  padding-top: var(--space-2);
}

.review-item {
  display: flex;
  gap: var(--space-2);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.review-item:last-child {
  border-bottom: none;
}

.review-main {
  flex: 1;
  min-width: 0;
}

.review-top {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex-wrap: wrap;
}

.review-user {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.review-time {
  margin-left: auto;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.review-text {
  margin: 6px 0 0;
  font-size: 14px;
  line-height: 1.7;
  color: var(--el-text-color-regular);
  word-break: break-word;
}

.review-images {
  display: flex;
  gap: var(--space-1);
  margin-top: var(--space-1);
  flex-wrap: wrap;
}

.review-img {
  width: 72px;
  height: 72px;
  border-radius: 8px;
  cursor: pointer;
}

.review-pager {
  display: flex;
  justify-content: center;
  padding-top: var(--space-2);
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
