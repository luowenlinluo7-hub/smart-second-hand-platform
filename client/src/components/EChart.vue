<script setup lang="ts">
import * as echarts from 'echarts'
import type { ECharts, EChartsOption } from 'echarts'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { BRAND_THEME_NAME, createBrandTheme } from '@/utils/echartsTheme'

const props = defineProps<{
  option: EChartsOption
  height?: string
}>()

const container = ref<HTMLDivElement | null>(null)
let chart: ECharts | null = null
let observer: ResizeObserver | null = null
let themeRegistered = false

// 主题必须在 init 之前注册，且只需注册一次
const ensureTheme = (): void => {
  if (themeRegistered) return
  echarts.registerTheme(BRAND_THEME_NAME, createBrandTheme())
  themeRegistered = true
}

onMounted(() => {
  if (!container.value) return
  ensureTheme()
  chart = echarts.init(container.value, BRAND_THEME_NAME)
  chart.setOption(props.option)

  // 用 ResizeObserver 而不是 window.resize：
  // 抽屉展开、侧栏折叠、栅格重排等「窗口没变但容器变了」的场景也必须重绘
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => {
      chart?.resize()
    })
    observer.observe(container.value)
  }
})

// option 变化时增量更新，避免重建实例
watch(
  () => props.option,
  (option) => {
    chart?.setOption(option)
  },
  { deep: true },
)

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  chart?.dispose()
  chart = null
})
</script>

<template>
  <div ref="container" :style="{ width: '100%', height: height ?? '320px' }" />
</template>
