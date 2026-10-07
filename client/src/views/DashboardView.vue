<script setup lang="ts">
import { computed, ref } from 'vue'
import type { EChartsOption } from 'echarts'
import EChart from '@/components/EChart.vue'

const days = ref(7)

// 示例数据：后续替换为 GET /api/dashboard/seller/trend 的真实返回
const dates = ['10-01', '10-02', '10-03', '10-04', '10-05', '10-06', '10-07']
const gmv = [1200, 860, 2400, 1780, 3200, 990, 2750]

const lineOption = computed<EChartsOption>(() => ({
  tooltip: { trigger: 'axis' },
  grid: { left: 56, right: 24, top: 32, bottom: 32 },
  xAxis: { type: 'category', data: dates.slice(-days.value) },
  yAxis: { type: 'value', name: '成交额(元)' },
  series: [
    {
      name: 'GMV',
      type: 'line',
      smooth: true,
      areaStyle: {},
      data: gmv.slice(-days.value),
    },
  ],
}))
</script>

<template>
  <el-card shadow="never">
    <template #header>
      <div class="card-header">
        <span>成交额趋势（ECharts 示例）</span>
        <el-radio-group v-model="days" size="small">
          <el-radio-button :value="7">近 7 天</el-radio-button>
          <el-radio-button :value="14">近 14 天</el-radio-button>
        </el-radio-group>
      </div>
    </template>

    <EChart :option="lineOption" height="360px" />
  </el-card>
</template>

<style scoped>
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
</style>
