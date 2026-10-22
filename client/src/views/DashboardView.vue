<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Goods, List, Money, User } from '@element-plus/icons-vue'
import type { EChartsOption } from 'echarts'
import EChart from '@/components/EChart.vue'
import EmptyState from '@/components/EmptyState.vue'
import { getDashboard } from '@/api/admin'
import { DataLine } from '@element-plus/icons-vue'
import { useIsMobile } from '@/composables/useIsMobile'
import { useCountUp } from '@/composables/useCountUp'
import type { DashboardData } from '@/types/api'

const router = useRouter()
const { isMobile } = useIsMobile()

const loading = ref(true)
const data = ref<DashboardData | null>(null)
// 首屏骨架屏：与 v-loading 一起用，避免图表容器出现跳动
const firstLoad = ref(true)
const days = ref(7)
// 趋势图的图例选中状态（true/缺失 = 可见）。图例点击后用于同步隐藏对应数值轴，
// 否则被关掉的那条轴会残留一个没有刻度的轴名，移动端看着像「左边的数字不见了」。
const legendSelected = ref<Record<string, boolean>>({})

// 金额统一按两位小数展示
const money = (value: string | number): string => Number(value).toFixed(2)

const fetchData = async (): Promise<void> => {
  loading.value = true
  try {
    data.value = await getDashboard({ days: days.value })
  } catch (error) {
    const message = error instanceof Error ? error.message : '加载失败'
    ElMessage.error(message)
    // 非管理员直接请回首页：导航栏里也看不到入口，正常不会走到这里
    router.replace('/')
  } finally {
    loading.value = false
    firstLoad.value = false
  }
}

const onDaysChange = (): void => {
  fetchData()
}

// 图表通用的空数据判断：没有数据时给一句提示，而不是留一块空白画布
const isEmptyTrend = computed(
  () => (data.value?.trend.orderCount.reduce((a, b) => a + b, 0) ?? 0) === 0,
)
const isEmptyStatus = computed(
  () => (data.value?.orderStatus.reduce((sum, i) => sum + i.value, 0) ?? 0) === 0,
)
const isEmptyCategory = computed(() => (data.value?.categoryShare.length ?? 0) === 0)
const isEmptyTop = computed(() => (data.value?.topProducts.length ?? 0) === 0)

// KPI 数字滚动：数据到位后从 0 递增到目标值。
// 用 computed 取目标值，再交给 useCountUp 做插值，模板只读动画值。
const kpiUserTarget = computed(() => data.value?.kpi.userCount ?? null)
const kpiProductTarget = computed(() => data.value?.kpi.productCount ?? null)
const kpiOrderTarget = computed(() => data.value?.kpi.orderCount ?? null)
const kpiGmvTarget = computed(() => (data.value ? Number(data.value.kpi.gmv) : null))

const animatedUser = useCountUp(kpiUserTarget)
const animatedProduct = useCountUp(kpiProductTarget)
const animatedOrder = useCountUp(kpiOrderTarget)
// GMV 带两位小数，滚动时也保持两位，避免数字长度跳动
const animatedGmv = useCountUp(kpiGmvTarget, { decimals: 2 })

const kpiCards = computed(() => {
  return [
    {
      key: 'user',
      label: '总用户数',
      value: animatedUser.value === null ? '—' : String(animatedUser.value),
      icon: User,
      suffix: '人',
    },
    {
      key: 'product',
      label: '总商品数',
      value: animatedProduct.value === null ? '—' : String(animatedProduct.value),
      icon: Goods,
      suffix: '件',
    },
    {
      key: 'order',
      label: '总订单数',
      value: animatedOrder.value === null ? '—' : String(animatedOrder.value),
      icon: List,
      suffix: '笔',
    },
    {
      key: 'gmv',
      label: '总成交额（GMV）',
      value: animatedGmv.value === null ? '—' : money(animatedGmv.value),
      icon: Money,
      suffix: '元',
    },
  ]
})

// 已付款订单占比（排除未付款与已取消）
const paidRatio = computed(() => {
  if (!data.value) return null
  const paid = data.value.orderStatus
    .filter((s) => s.status !== 'PENDING_PAYMENT' && s.status !== 'CANCELLED')
    .reduce((sum, s) => sum + s.value, 0)
  return ((paid / Math.max(data.value.kpi.orderCount, 1)) * 100).toFixed(1)
})

// ---------- 图表配置 ----------

// GMV 趋势：金额走左轴，订单量走右轴
const trendOption = computed<EChartsOption>(() => {
  const trend = data.value?.trend
  const gmv = (trend?.gmv ?? []).map((v) => Number(v))
  const orderCount = trend?.orderCount ?? []
  // 系列被图例关掉时，对应数值轴整条一起隐藏。
  // 只关系列、留着轴的话，ECharts 会因为该轴上没有可见 series 而把**整列刻度数字**
  // 抹掉（只剩轴名孤零零挂在画布边），同时 containLabel 重算网格会把 X 轴首尾
  // 标签挤出画布 —— 用户看到的就是「左边的数字不见了」。
  const showGmvAxis = legendSelected.value['成交额'] !== false
  const showOrderAxis = legendSelected.value['订单量'] !== false
  return {
    tooltip: {
      trigger: 'axis',
      // 两条序列单位不同，必须分别格式化：
      // 金额保留两位小数，订单量是整数（不能套统一的 toFixed(2)，否则订单量会显示成 "3.00"）
      formatter: (params) => {
        const list = Array.isArray(params) ? params : [params]
        const first = list[0] as { axisValue?: string } | undefined
        const lines: string[] = [String(first?.axisValue ?? '')]
        for (const raw of list) {
          const item = raw as { seriesName?: string; value?: unknown; marker?: string }
          const value = Number(item.value ?? 0)
          const text =
            item.seriesName === '成交额' ? `¥${value.toFixed(2)}` : `${Math.round(value)} 笔`
          lines.push(`${item.marker ?? ''}${item.seriesName}：${text}`)
        }
        return lines.join('<br/>')
      },
    },
    // 图例居中：左右轴名分别贴在画布两侧，居中才不会与它们挤在一起
    legend: { data: ['成交额', '订单量'], top: 0, left: 'center' },
    // top 留出图例与轴名的空间，避免轴名压到图例或数据线。
    // left/right 给到 32 是兜底：boundaryGap:false 时首尾数据点贴着网格边缘，
    // 标签居中就会溢出画布（左轴的「10-16」被裁成「0-16」）。正常显示双轴时
    // containLabel 算出的边距远大于 32，所以这个值只在某条轴被图例关掉后才起作用。
    grid: { left: 32, right: 32, top: 64, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: trend?.dates ?? [],
      // 移动端日期刻度会重叠，交给 ECharts 自动稀疏显示
      axisLabel: { interval: isMobile.value ? 'auto' : 0, hideOverlap: true },
    },
    yAxis: [
      {
        type: 'value',
        name: '成交额(元)',
        nameGap: 16,
        nameTextStyle: { align: 'left', padding: [0, 0, 0, -8] },
        show: showGmvAxis,
      },
      {
        type: 'value',
        name: '订单量(笔)',
        // 订单量是整数，避免出现 0.5 这种刻度
        minInterval: 1,
        nameGap: 16,
        nameTextStyle: { align: 'right', padding: [0, -8, 0, 0] },
        show: showOrderAxis,
      },
    ],
    series: [
      {
        name: '成交额',
        type: 'line',
        smooth: true,
        symbolSize: 6,
        yAxisIndex: 0,
        areaStyle: { opacity: 0.12 },
        data: gmv,
      },
      {
        name: '订单量',
        type: 'line',
        smooth: true,
        symbolSize: 6,
        yAxisIndex: 1,
        data: orderCount,
      },
    ],
  }
})

// 图例点击后同步选中状态，驱动上面的 yAxis.show
const onTrendLegendChange = (selected: Record<string, boolean>): void => {
  legendSelected.value = { ...selected }
}

const statusOption = computed<EChartsOption>(() => ({
  tooltip: { trigger: 'item', formatter: '{b}: {c} 笔 ({d}%)' },
  legend: { bottom: 0, type: 'scroll' },
  series: [
    {
      name: '订单状态',
      type: 'pie',
      radius: ['38%', '62%'],
      center: ['50%', '46%'],
      avoidLabelOverlap: true,
      // 描边色与圆角由 brand 主题统一提供（pie.itemStyle）
      // 移动端画布窄，外置标签会互相挤压，改为只看图例
      label: { show: !isMobile.value, formatter: '{b}\n{c} 笔' },
      labelLine: { show: !isMobile.value },
      data: (data.value?.orderStatus ?? []).map((item) => ({
        name: item.name,
        value: item.value,
      })),
    },
  ],
}))

const categoryOption = computed<EChartsOption>(() => ({
  tooltip: { trigger: 'item', formatter: '{b}: {c} 件 ({d}%)' },
  legend: { bottom: 0 },
  series: [
    {
      name: '商品分类',
      type: 'pie',
      // 环形图：与上面的订单状态饼图在视觉上做出区分
      radius: ['46%', '66%'],
      center: ['50%', '46%'],
      label: { show: !isMobile.value, formatter: '{b}\n{c} 件' },
      labelLine: { show: !isMobile.value },
      data: (data.value?.categoryShare ?? []).map((item) => ({
        name: item.name,
        value: item.value,
      })),
    },
  ],
}))

// 高价值商品 Top 5：横向柱状图，成交额与销量都放进 tooltip
const topOption = computed<EChartsOption>(() => {
  const items = data.value?.topProducts ?? []
  // 横向柱状图的类目轴从下往上排，倒序后第一名才会显示在最上方
  const ordered = [...items].reverse()
  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) => {
        const list = Array.isArray(params) ? params : [params]
        const first = list[0] as { dataIndex?: number } | undefined
        const index = first?.dataIndex ?? 0
        const item = ordered[index]
        if (!item) return ''
        return `${item.title}<br/>成交额：¥${money(item.totalAmount)}<br/>销量：${item.totalQuantity} 件`
      },
    },
    grid: { left: 12, right: 70, top: 16, bottom: 8, containLabel: true },
    // 移动端画布窄，数值轴刻度会互相压字；柱尾已有金额标签，故窄屏隐藏数值轴
    xAxis: {
      type: 'value',
      name: isMobile.value ? '' : '成交额(元)',
      axisLabel: { show: !isMobile.value },
    },
    yAxis: {
      type: 'category',
      data: ordered.map((item) => item.title),
      axisLabel: { width: isMobile.value ? 96 : 140, overflow: 'truncate' },
    },
    series: [
      {
        type: 'bar',
        barMaxWidth: 26,
        itemStyle: { borderRadius: [0, 6, 6, 0] },
        label: {
          show: true,
          position: 'right',
          formatter: (params) => `¥${money(params.value as number)}`,
        },
        data: ordered.map((item) => Number(item.totalAmount)),
      },
    ],
  }
})

onMounted(fetchData)
</script>

<template>
  <div class="page">
    <!-- 顶部：标题 + 时间范围切换 -->
    <el-card shadow="never" class="toolbar-card">
      <div class="toolbar">
        <div>
          <div class="page-title">数据看板</div>
          <div class="page-subtitle">指标实时聚合自数据库，非静态示例数据</div>
        </div>
        <el-radio-group v-model="days" size="small" :disabled="loading" @change="onDaysChange">
          <el-radio-button :value="7">近 7 天</el-radio-button>
          <el-radio-button :value="14">近 14 天</el-radio-button>
          <el-radio-button :value="30">近 30 天</el-radio-button>
        </el-radio-group>
      </div>
    </el-card>

    <!-- KPI 卡片 -->
    <el-row :gutter="16">
      <el-col v-for="card in kpiCards" :key="card.key" :xs="24" :sm="12" :md="6">
        <el-card v-loading="loading" shadow="never" class="kpi-card">
          <div class="kpi-body">
            <div class="kpi-icon">
              <el-icon :size="22"><component :is="card.icon" /></el-icon>
            </div>
            <div class="kpi-text">
              <div class="kpi-label">{{ card.label }}</div>
              <div class="kpi-value">
                {{ card.value }}
                <span class="kpi-suffix">{{ card.suffix }}</span>
              </div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 附加指标 -->
    <el-row :gutter="16">
      <el-col :xs="12" :sm="12" :md="6">
        <el-card v-loading="loading" shadow="never" class="mini-card">
          <div class="mini-label">在售商品</div>
          <div class="mini-value">{{ data?.kpi.onSaleCount ?? '—' }} 件</div>
        </el-card>
      </el-col>
      <el-col :xs="12" :sm="12" :md="6">
        <el-card v-loading="loading" shadow="never" class="mini-card">
          <div class="mini-label">待审核商品</div>
          <div class="mini-value">{{ data?.kpi.pendingAuditCount ?? '—' }} 件</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card v-loading="loading" shadow="never" class="mini-card">
          <div class="mini-label">平均履约时长（付款 → 发货）</div>
          <div class="mini-value">
            <template v-if="data?.fulfillment.avgHours != null">
              {{ data.fulfillment.avgHours }} 小时
              <span class="mini-hint">样本 {{ data.fulfillment.sampleCount }} 单</span>
            </template>
            <template v-else>暂无数据</template>
          </div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="12" :md="6">
        <el-card v-loading="loading" shadow="never" class="mini-card">
          <div class="mini-label">已付款订单占比</div>
          <div class="mini-value">
            <template v-if="paidRatio !== null">{{ paidRatio }} %</template>
            <template v-else>—</template>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 图表区 -->
    <el-skeleton v-if="firstLoad" :rows="8" animated class="skeleton" />
    <template v-else>
      <el-card v-loading="loading" shadow="never" class="chart-card">
        <template #header><span class="chart-title">成交额与订单量趋势</span></template>
        <EmptyState v-if="isEmptyTrend" :icon="DataLine" title="该时间段暂无订单" compact />
        <EChart
          v-else
          :option="trendOption"
          height="var(--chart-h-lg)"
          @legend-change="onTrendLegendChange"
        />
      </el-card>

      <el-row :gutter="16">
        <el-col :xs="24" :md="12">
          <el-card v-loading="loading" shadow="never" class="chart-card">
            <template #header><span class="chart-title">订单状态分布</span></template>
            <EmptyState v-if="isEmptyStatus" :icon="DataLine" title="暂无订单" compact />
            <EChart v-else :option="statusOption" height="var(--chart-h-md)" />
          </el-card>
        </el-col>
        <el-col :xs="24" :md="12">
          <el-card v-loading="loading" shadow="never" class="chart-card">
            <template #header><span class="chart-title">商品分类占比</span></template>
            <EmptyState v-if="isEmptyCategory" :icon="DataLine" title="暂无商品" compact />
            <EChart v-else :option="categoryOption" height="var(--chart-h-md)" />
          </el-card>
        </el-col>
      </el-row>

      <el-card v-loading="loading" shadow="never" class="chart-card">
        <template #header><span class="chart-title">高价值商品 Top 5（按成交额）</span></template>
        <EmptyState v-if="isEmptyTop" :icon="DataLine" title="暂无成交记录" compact />
        <EChart v-else :option="topOption" height="var(--chart-h-md)" />
      </el-card>
    </template>
  </div>
</template>

<style scoped>
.toolbar-card {
  margin-bottom: var(--space-2);
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.page-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.page-subtitle {
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.kpi-card {
  margin-bottom: var(--space-2);
}

.kpi-body {
  display: flex;
  align-items: center;
  gap: 12px;
}

.kpi-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.kpi-text {
  min-width: 0;
}

.kpi-label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.kpi-value {
  margin-top: 4px;
  font-size: 22px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  white-space: nowrap;
}

.kpi-suffix {
  margin-left: 2px;
  font-size: 12px;
  font-weight: 400;
  color: var(--el-text-color-secondary);
}

.mini-card {
  margin-bottom: var(--space-2);
}

.mini-label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.mini-value {
  margin-top: 6px;
  font-size: 17px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.mini-hint {
  margin-left: 6px;
  font-size: 12px;
  font-weight: 400;
  color: var(--el-text-color-placeholder);
}

.skeleton {
  padding: var(--space-2);
}

.chart-card {
  margin-bottom: var(--space-2);
}

.chart-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

/* ---------- 移动端 ---------- */
@media (max-width: 767px) {
  /* 工具条与单选组在窄屏上下堆叠 */
  .toolbar {
    align-items: flex-start;
  }

  /* KPI 变成单列后，收窄卡片内边距，避免 4 张卡吃掉首屏 */
  .kpi-card :deep(.el-card__body) {
    padding: var(--space-2);
  }

  .kpi-value {
    font-size: 20px;
  }

  .mini-hint {
    display: block;
    margin-left: 0;
  }
}
</style>
