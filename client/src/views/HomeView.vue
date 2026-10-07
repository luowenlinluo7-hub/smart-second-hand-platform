<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { getHealth } from '@/api/health'
import { useAppStore } from '@/stores/app'
import type { HealthData } from '@/types/api'

const appStore = useAppStore()
const loading = ref(false)
const health = ref<HealthData | null>(null)

// 调用 GET /api/health，验证前后端链路是否打通
const checkHealth = async (): Promise<void> => {
  loading.value = true
  try {
    health.value = await getHealth()
    appStore.setOnline(true)
    ElMessage.success('后端连接正常')
  } catch (error) {
    health.value = null
    appStore.setOnline(false)
    ElMessage.error(error instanceof Error ? error.message : '后端连接失败')
  } finally {
    loading.value = false
  }
}

onMounted(checkHealth)
</script>

<template>
  <el-card shadow="never">
    <template #header>
      <div class="card-header">
        <span>后端连通性自检</span>
        <el-button type="primary" :loading="loading" @click="checkHealth">重新检测</el-button>
      </div>
    </template>

    <el-descriptions v-if="health" :column="2" border>
      <el-descriptions-item label="状态">
        <el-tag type="success">{{ health.status }}</el-tag>
      </el-descriptions-item>
      <el-descriptions-item label="服务名">{{ health.service }}</el-descriptions-item>
      <el-descriptions-item label="已运行（秒）">{{ health.uptime }}</el-descriptions-item>
      <el-descriptions-item label="服务器时间">{{ health.timestamp }}</el-descriptions-item>
    </el-descriptions>

    <el-empty v-else description="后端未连接，请先在 server 目录执行 npm run dev" />
  </el-card>
</template>

<style scoped>
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
</style>
