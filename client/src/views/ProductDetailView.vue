<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { CarouselInstance } from 'element-plus'
import { ChatDotRound } from '@element-plus/icons-vue'
import { getProduct, getProductReviews } from '@/api/product'
import { getUserProfile } from '@/api/user'
import EmptyState from '@/components/EmptyState.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import { useIsMobile } from '@/composables/useIsMobile'
import { useAiChatStore } from '@/stores/aiChat'
import { useAuthStore } from '@/stores/auth'
import { useCartStore } from '@/stores/cart'
import { CONDITION_LABEL } from '@/constants/status'
import { formatDate } from '@/utils/format'
import type { Product, ProductReview, ReviewSummary, SellerProfile } from '@/types/api'

const route = useRoute()
const router = useRouter()
const aiChat = useAiChatStore()
const authStore = useAuthStore()
const cartStore = useCartStore()
const { isMobile } = useIsMobile()

const loading = ref(false)
const product = ref<Product | null>(null)

// 图库：主图轮播 + 缩略图条
const carouselRef = ref<CarouselInstance>()
const activeSlide = ref(0)
// 商品图可能是空数组，统一成数组便于模板里判空
const images = computed<string[]>(() => product.value?.images ?? [])
const onSlideChange = (index: number): void => {
  activeSlide.value = index
}
const goSlide = (index: number): void => {
  carouselRef.value?.setActiveItem(index)
}

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

// 立即购买：只结算这一件商品，走独立参数，不写进购物车。
// 老实现是 add() 后跳 /cart，会把购物车里已有的商品一起下单（多付钱）。
const buyNow = (): void => {
  if (!ensureBuyable() || !product.value) return
  router.push({ path: '/cart', query: { buyNow: product.value.id } })
}

// 打开 AI 助手并让它知道用户正在看这件商品，
// 这样「这件成色怎么样」里的「这件」才能被正确消解
const askAi = (): void => {
  aiChat.open()
}

// 加载商品主体 + 卖家统计 + 评价。
// 同一路由下切换商品时会被重复调用，所以先重置上一件商品的数据，避免残留。
const loadProduct = async (id: string): Promise<void> => {
  loading.value = true
  product.value = null
  seller.value = null
  reviews.value = []
  reviewSummary.value = null
  reviewTotal.value = 0
  reviewPage.value = 1
  // 先把当前浏览的商品告诉助手，用户此时问「这件成色怎么样」才有意义
  aiChat.setFocusProduct(id)
  try {
    product.value = await getProduct(id)
    // 关闭自动轮播后，仍主动归零一次：EP 在「item 异步插入」时可能停在非首帧
    await nextTick()
    carouselRef.value?.setActiveItem(0)
    activeSlide.value = 0

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
}

onMounted(() => {
  void loadProduct(String(route.params.id))
})

// 从 AI 助手商品卡等处跳转到另一件商品时，路由记录相同、组件不会重建，
// 必须监听 id 重新加载；否则页面仍显示上一件商品，加购/下单都会下错。
watch(
  () => route.params.id,
  (id) => {
    if (typeof id === 'string' && id) {
      // 换商品时图库回到第一张，否则会停在上一个商品的第 N 张
      activeSlide.value = 0
      void loadProduct(id)
    }
  },
)

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
          <!-- 左侧图库：主图 + 缩略图条 -->
          <el-col :xs="24" :md="10">
            <div class="gallery">
              <el-carousel
                v-if="images.length"
                ref="carouselRef"
                height="var(--carousel-h)"
                indicator-position="none"
                :autoplay="false"
                @change="onSlideChange"
              >
                <el-carousel-item v-for="(img, i) in images" :key="i">
                  <img :src="img" class="carousel-img" alt="商品图" />
                </el-carousel-item>
              </el-carousel>
              <div v-else class="no-image">暂无图片</div>

              <!-- 缩略图只在多图时出现；单图无需让用户点第二次 -->
              <div v-if="images.length > 1" class="thumb-strip">
                <button
                  v-for="(img, i) in images"
                  :key="i"
                  type="button"
                  class="thumb-btn"
                  :class="{ 'is-active': i === activeSlide }"
                  :aria-label="`查看第 ${i + 1} 张图片`"
                  @click="goSlide(i)"
                >
                  <img :src="img" alt="" />
                </button>
              </div>
            </div>
          </el-col>

          <!-- 右侧信息 -->
          <el-col :xs="24" :md="14">
            <h2 class="title">{{ product.title }}</h2>
            <div class="price-row">
              <span class="price">¥{{ product.price }}</span>
              <span v-if="product.originalPrice" class="original">原价 ¥{{ product.originalPrice }}</span>
            </div>
            <el-descriptions :column="isMobile ? 1 : 2" class="info" border>
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
                {{ product.publishedAt ? formatDate(product.publishedAt) : '-' }}
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
          <EmptyState
            v-if="!reviewLoading && reviewTotal === 0"
            :icon="ChatDotRound"
            title="该商品还没有评价"
            description="买家完成交易后即可在这里留下评价"
            compact
          />

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

.gallery {
  width: 100%;
}

/* 主图圆角与卡片保持一致（12px），并加一层极淡的投影让图片「放进」卡片里 */
.carousel-img {
  width: 100%;
  height: var(--carousel-h);
  object-fit: cover;
  border-radius: var(--el-card-border-radius);
  box-shadow: var(--el-box-shadow-lighter);
}

.no-image {
  height: var(--carousel-h);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-placeholder);
  border-radius: var(--el-card-border-radius);
}

/* 缩略图条：56px 方块，选中项用主色描边 */
.thumb-strip {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin-top: var(--space-1);
}

.thumb-btn {
  width: 56px;
  height: 56px;
  padding: 0;
  overflow: hidden;
  border: 2px solid transparent;
  border-radius: var(--el-border-radius-base);
  background-color: var(--el-fill-color-light);
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    transform 0.2s ease;
}

.thumb-btn img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.thumb-btn:hover {
  border-color: var(--el-color-primary-light-5);
}

.thumb-btn.is-active {
  border-color: var(--el-color-primary);
}

.thumb-btn:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}

.title {
  margin: 0 0 var(--space-2);
  font-family: var(--font-title);
  font-size: 22px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--el-text-color-primary);
}

.price-row {
  display: flex;
  align-items: baseline;
  gap: var(--space-1);
  flex-wrap: wrap;
  margin-bottom: var(--space-2);
}

.price {
  color: var(--price-color);
  font-size: 28px;
  font-weight: 700;
}

.original {
  color: var(--el-text-color-placeholder);
  font-size: 13px;
  text-decoration: line-through;
}

.info {
  margin-bottom: var(--space-1);
}

.description {
  margin: 0;
  font-size: 15px;
  line-height: 1.85;
  color: var(--el-text-color-regular);
  white-space: pre-wrap;
  word-break: break-word;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin-top: var(--space-3);
}

.actions .el-button {
  margin-left: 0;
}

/* ---------- 移动端 ---------- */
@media (max-width: 767px) {
  .title {
    font-size: 18px;
    margin-bottom: var(--space-1);
  }

  .price {
    font-size: 22px;
  }

  /* 缩略图在窄屏缩小，5 张也不会换行 */
  .thumb-btn {
    width: 48px;
    height: 48px;
  }

  /* 操作按钮纵向铺满，避免 4 个按钮挤成一行被截断 */
  .actions {
    flex-direction: column;
    align-items: stretch;
  }

  .actions .el-button {
    width: 100%;
  }

  /* 卖家卡与评价概览从横排改竖排 */
  .seller-card {
    flex-direction: column;
    align-items: flex-start;
  }

  .review-summary {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-2);
  }

  .summary-score {
    flex-direction: row;
    justify-content: flex-start;
    gap: var(--space-1);
    min-width: 0;
  }
}
</style>
