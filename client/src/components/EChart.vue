<script setup lang="ts">
import * as echarts from 'echarts'
import type { ECharts, EChartsOption } from 'echarts'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { BRAND_THEME_NAME, createBrandTheme } from '@/utils/echartsTheme'
import { prefersReducedMotion } from '@/utils/motion'

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

// 无障碍：系统开启「减少动态效果」时彻底关掉动画。
// 主题在启动时只注册一次，改不了；这里每次设置 option 都覆盖一次更可靠。
const withMotionPreference = (option: EChartsOption): EChartsOption =>
  prefersReducedMotion() ? { ...option, animation: false } : option

onMounted(() => {
  if (!container.value) return
  ensureTheme()
  chart = echarts.init(container.value, BRAND_THEME_NAME)
  chart.setOption(withMotionPreference(props.option))

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
    chart?.setOption(withMotionPreference(option))
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
