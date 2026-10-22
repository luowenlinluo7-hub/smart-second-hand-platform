// 动效偏好：系统级「减少动态效果」检测
//
// 无障碍要求（也是答辩演示的稳定性保障）：用户或评委机器关闭动画时，
// 图表与数字滚动都不应该播放，直接给最终状态。

export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches
