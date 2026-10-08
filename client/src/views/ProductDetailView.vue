<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { getProduct } from '@/api/product'
import type { Product, ProductCondition } from '@/types/api'

const route = useRoute()
const router = useRouter()

const loading = ref(false)
const product = ref<Product | null>(null)

const conditionLabels: Record<ProductCondition, string> = {
  NEW: '全新',
  LIKE_NEW: '几乎全新',
  GOOD: '轻微使用痕迹',
  FAIR: '明显使用痕迹',
}

onMounted(async () => {
  loading.value = true
  try {
    product.value = await getProduct(String(route.params.id))
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '加载失败')
  } finally {
    loading.value = false
  }
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
                {{ conditionLabels[product.condition] }}
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
              <el-button type="primary" disabled>联系卖家（待开发）</el-button>
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
  background: #f5f7fa;
  color: #c0c4cc;
}

.title {
  margin: 0 0 16px;
  font-size: 22px;
  color: #303133;
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
  color: #c0c4cc;
  text-decoration: line-through;
}

.info {
  margin-bottom: 8px;
}

.description {
  color: #606266;
  line-height: 1.8;
  white-space: pre-wrap;
}

.actions {
  margin-top: 24px;
}
</style>
