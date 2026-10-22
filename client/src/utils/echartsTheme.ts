// ECharts 品牌主题
//
// 为什么需要它：ECharts 默认色板（#5470c6 蓝 / #91cc75 绿 / #fac858 亮黄 / #ee6666 红）
// 与本站的暖橙品牌色完全脱节，导致「页面是暖的、图表是冷的」这种割裂感。
//
// 做法：注册一个名为 brand 的主题，色板全部从主色 #ff6b35 派生（暖橙 → 琥珀 → 砖红 →
// 沙棕 → 赭石），并统一坐标轴 / 图例 / tooltip / 饼图的描边与字体。
// 图表 option 里不再需要写任何颜色，由主题统一接管。
//
// 颜色取值优先读 theme.css 的 token（canvas 无法解析 CSS 变量，必须取实际色值），
// 因此主题与页面共用同一套色源，改 theme.css 即可整体联动。

import { readCssVar } from './cssVar'

export const BRAND_THEME_NAME = 'brand'

// 以暖橙为首的色板：饱和度整体压低，避免刺眼。
// 顺序有讲究 —— 前两位是趋势图的两条线，必须是「橙 vs 暖灰褐」这种明显区分的组合；
// 若第二个用琥珀，两条重叠的曲线在面积叠加处几乎分不清。
const BRAND_PALETTE = [
  '#ff6b35', // 品牌暖橙（主序列，如成交额）
  '#8c6f5a', // 暖灰褐（次序列，如订单量）—— 与主色同属暖调但明度/彩度差异大
  '#d95f4b', // 砖红
  '#f2a65a', // 低饱和琥珀
  '#a85f3f', // 赭石
  '#e2b9a4', // 浅陶
  '#c98f5f', // 沙棕
  '#b8875c', // 驼色
]

// 主题在运行时构建：需要读取已经生效的 CSS 变量
export const createBrandTheme = (): Record<string, unknown> => {
  const surface = readCssVar('--el-bg-color-overlay', '#faf9f7')
  const textPrimary = readCssVar('--el-text-color-primary', '#1a1a1a')
  const textRegular = readCssVar('--el-text-color-regular', '#666666')
  const textSecondary = readCssVar('--el-text-color-secondary', '#999999')
  const borderLight = readCssVar('--el-border-color-light', '#ece8e2')
  const borderLighter = readCssVar('--el-border-color-lighter', '#f1eee9')
  const fontFamily = readCssVar('--el-font-family', 'sans-serif') || 'sans-serif'

  return {
    color: BRAND_PALETTE,
    // 透明底，让卡片自身的暖白透出来，避免图表区出现一块白色矩形
    backgroundColor: 'transparent',

    // ---------- 入场动画 ----------
    // 默认值是 1000ms 线性缓动，看起来"平移"过去没有质感；
    // 这里统一改成 cubicOut 收尾更稳，并按数据下标做阶梯延迟，
    // 让柱状 / 饼图的各个分片依次出现，而不是整块同时弹出。
    // 无障碍降级在 EChart.vue 里做（那里能感知 prefers-reduced-motion 的变化）。
    animationDuration: 800,
    animationEasing: 'cubicOut',
    animationDelay: (idx: number): number => idx * 50,

    textStyle: {
      fontFamily,
      color: textRegular,
    },

    title: {
      textStyle: { color: textPrimary, fontWeight: 600 },
      subtextStyle: { color: textSecondary },
    },

    legend: {
      // 圆角小方块比默认的细长图形更贴合本站的圆角语言
      icon: 'roundRect',
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 16,
      textStyle: { color: textRegular, fontSize: 12 },
    },

    tooltip: {
      backgroundColor: surface,
      borderColor: borderLight,
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: textPrimary, fontSize: 12 },
      extraCssText: 'box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1); border-radius: 8px;',
      axisPointer: {
        lineStyle: { color: borderLight, width: 1 },
        crossStyle: { color: borderLight },
        // 柱状图的指示阴影用主色低透明度，保持暖调
        shadowStyle: { color: 'rgba(255, 107, 53, 0.08)' },
      },
    },

    // 类目轴（x 轴 / 横向柱图的 y 轴）
    categoryAxis: {
      axisLine: { lineStyle: { color: borderLight } },
      axisTick: { show: false },
      axisLabel: { color: textSecondary, fontSize: 12 },
      splitLine: { show: false },
    },

    // 数值轴
    valueAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: textSecondary, fontSize: 12 },
      // 虚线分隔线比实线更轻，不会压过数据
      splitLine: { lineStyle: { color: borderLighter, type: 'dashed' } },
    },

    line: {
      symbol: 'circle',
      symbolSize: 6,
      smooth: true,
      lineStyle: { width: 2 },
    },

    bar: {
      barMaxWidth: 26,
      // 横向柱图只圆右侧两角，起点仍贴着轴线
      itemStyle: { borderRadius: [0, 6, 6, 0] },
    },

    pie: {
      // 描边取页面底色，让扇区之间形成干净的缝隙
      itemStyle: { borderColor: surface, borderWidth: 2, borderRadius: 6 },
      label: { color: textRegular, fontSize: 12 },
      labelLine: { lineStyle: { color: borderLight } },
    },
  }
}
