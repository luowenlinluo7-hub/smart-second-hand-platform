<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules, type UploadFile } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { createProduct, getProduct, updateProduct } from '@/api/product'
import { getCategories } from '@/api/category'
import { useIsMobile } from '@/composables/useIsMobile'
import { useAuthStore } from '@/stores/auth'
import { CONDITION_OPTIONS } from '@/constants/status'
import type { Category, ProductCondition } from '@/types/api'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const { isMobile } = useIsMobile()

// 编辑模式：路由带 id 则为编辑
const editId = typeof route.params.id === 'string' ? route.params.id : ''
const isEdit = !!editId

const formRef = ref<FormInstance>()
const loading = ref(false)
const submitting = ref(false)
const categories = ref<Category[]>([])

const form = reactive({
  title: '',
  description: '',
  price: undefined as number | undefined,
  originalPrice: undefined as number | undefined,
  condition: 'GOOD' as ProductCondition,
  categoryId: '',
  stock: 1,
})

// 图片：URL 数组 + el-upload 的 file-list
const images = ref<string[]>([])
const fileList = ref<UploadFile[]>([])

// 上传请求头：携带 JWT
const uploadHeaders = {
  Authorization: `Bearer ${authStore.token ?? ''}`,
}

const rules: FormRules = {
  title: [{ required: true, message: '请输入标题', trigger: 'blur' }],
  price: [{ required: true, message: '请输入价格', trigger: 'blur' }],
  categoryId: [{ required: true, message: '请选择分类', trigger: 'change' }],
}

// 上传成功：从响应取 URL 存到 images，并设置 file.url 供预览
const onUploadSuccess = (response: { code: number; data: { urls: string[] } }, file: UploadFile): void => {
  if (response.code !== 0 || !response.data?.urls?.length) {
    ElMessage.error('图片上传失败')
    return
  }
  const url = response.data.urls[0]
  file.url = url
  images.value.push(url)
}

const onUploadError = (): void => {
  ElMessage.error('图片上传失败')
}

// 移除图片：从 images 中剔除对应 URL
const onUploadRemove = (file: UploadFile): void => {
  images.value = images.value.filter((url) => url !== file.url)
}

const onSubmit = async (): Promise<void> => {
  if (!formRef.value) return
  const valid = await formRef.value.validate().then(() => true).catch(() => false)
  if (!valid) return

  submitting.value = true
  try {
    const payload = {
      title: form.title,
      description: form.description || undefined,
      price: form.price ?? 0,
      originalPrice: form.originalPrice,
      images: images.value,
      condition: form.condition,
      categoryId: form.categoryId,
      stock: form.stock,
    }

    if (isEdit) {
      await updateProduct(editId, payload)
      ElMessage.success('更新成功')
    } else {
      await createProduct(payload)
      ElMessage.success('发布成功')
    }
    router.push('/')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '提交失败')
  } finally {
    submitting.value = false
  }
}

onMounted(async () => {
  try {
    categories.value = await getCategories()
  } catch {
    // 分类加载失败不阻断表单
  }

  if (isEdit) {
    loading.value = true
    try {
      const p = await getProduct(editId)
      form.title = p.title
      form.description = p.description ?? ''
      form.price = Number(p.price)
      form.originalPrice = p.originalPrice ? Number(p.originalPrice) : undefined
      form.condition = p.condition
      form.categoryId = p.categoryId
      form.stock = p.stock
      images.value = [...p.images]
      fileList.value = p.images.map((url, i) => ({ name: `图${i + 1}`, url, status: 'success' as const, uid: i }))
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : '加载失败')
      router.push('/')
    } finally {
      loading.value = false
    }
  }
})
</script>

<template>
  <div v-loading="loading" class="form-page">
    <el-card shadow="never">
      <template #header>
        <span>{{ isEdit ? '编辑商品' : '发布商品' }}</span>
      </template>

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        :label-position="isMobile ? 'top' : 'right'"
        :label-width="isMobile ? 'auto' : '90px'"
      >
        <el-form-item label="标题" prop="title">
          <el-input v-model="form.title" placeholder="商品标题（1-100 字）" maxlength="100" show-word-limit />
        </el-form-item>

        <el-form-item label="描述">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="4"
            placeholder="商品描述，如成色细节、使用情况等（选填）"
            maxlength="2000"
            show-word-limit
          />
        </el-form-item>

        <el-form-item label="价格" prop="price">
          <el-input-number v-model="form.price" :min="0" :precision="2" :step="10" class="form-control" />
          <span class="unit">元</span>
        </el-form-item>

        <el-form-item label="原价">
          <el-input-number v-model="form.originalPrice" :min="0" :precision="2" :step="10" class="form-control" />
          <span class="unit">元（选填，用于展示折扣）</span>
        </el-form-item>

        <el-form-item label="成色" prop="condition">
          <el-select v-model="form.condition" class="form-control">
            <el-option
              v-for="item in CONDITION_OPTIONS"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </el-form-item>

        <el-form-item label="分类" prop="categoryId">
          <el-select v-model="form.categoryId" placeholder="请选择分类" class="form-control">
            <el-option v-for="c in categories" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>

        <el-form-item label="库存">
          <el-input-number v-model="form.stock" :min="1" :max="999" class="form-control" />
          <span class="unit">件</span>
        </el-form-item>

        <el-form-item label="商品图片">
          <el-upload
            v-model:file-list="fileList"
            class="uploader"
            action="/api/upload"
            name="files"
            list-type="picture-card"
            :headers="uploadHeaders"
            multiple
            :limit="9"
            :on-success="onUploadSuccess"
            :on-error="onUploadError"
            :on-remove="onUploadRemove"
          >
            <el-icon><Plus /></el-icon>
          </el-upload>
          <div class="upload-tip">最多 9 张，支持 jpg / png / webp / gif，单张 ≤5MB</div>
        </el-form-item>

        <el-form-item>
          <el-button type="primary" :loading="submitting" @click="onSubmit">
            {{ isEdit ? '保存修改' : '发布' }}
          </el-button>
          <el-button @click="router.back()">取消</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<style scoped>
.form-page {
  max-width: 760px;
  margin: 0 auto;
}

/* 表单控件宽度统一在此控制，避免内联固定像素 */
.form-control {
  width: 220px;
}

.unit {
  margin-left: 8px;
  color: var(--el-text-color-secondary);
}

.upload-tip {
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
  margin-top: var(--space-1);
}

/* 上传区与头像框共用同一套视觉：12px 圆角 + 虚线边框 + hover 变主色淡橙底 */
.uploader :deep(.el-upload--picture-card) {
  border: 1px dashed var(--upload-border);
  border-radius: var(--upload-radius);
  background-color: var(--el-fill-color-blank);
  transition:
    border-color 0.2s ease,
    background-color 0.2s ease;
}

.uploader :deep(.el-upload--picture-card:hover) {
  border-color: var(--el-color-primary);
  background-color: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.uploader :deep(.el-upload-list--picture-card .el-upload-list__item) {
  border-radius: var(--upload-radius);
  overflow: hidden;
}

/* ---------- 移动端 ---------- */
@media (max-width: 767px) {
  .form-page {
    max-width: 100%;
  }

  .form-control {
    width: 100%;
  }

  /* 「元（选填，用于展示折扣）」这类说明在窄屏换行，不再挤在一行 */
  .unit {
    margin-left: 0;
    margin-top: 4px;
    display: block;
  }
}
</style>
