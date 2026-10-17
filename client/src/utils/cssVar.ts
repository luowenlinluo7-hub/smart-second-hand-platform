// 读取主题 token 的真实颜色值
//
// ECharts / canvas 之类的绘制层无法解析 `var(--xxx)`，必须拿到最终色值。
// 这样图表颜色仍以 theme.css 为唯一来源，而不是在 JS 里再抄一份十六进制。
//
// 注意：theme.css 必须在应用挂载前就位（main.ts 的引入顺序已保证），
// 否则这里读到的会是空串，从而回退到 fallback。

export const readCssVar = (name: string, fallback: string): string => {
  if (typeof window === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

/** 页面 / 卡片底色，用于饼图扇区之间的描边（与背景同色才显得「分离」） */
export const surfaceColor = (): string => readCssVar('--el-bg-color-overlay', '#faf9f7')
