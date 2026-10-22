// 数字滚动动画：让 KPI 从 0 递增到目标值，而不是直接跳变
//
// 为什么手写而不是引第三方：项目对「零依赖」有约束，且这里需求量很小
// （一次插值 + 缓动），一个 requestAnimationFrame 循环就够。
//
// 无障碍：系统开启「减少动态效果」时直接返回目标值，不做动画。

import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { prefersReducedMotion } from '@/utils/motion'

// easeOutCubic：末尾收得慢，数字停在目标值上更自然
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3)

export interface CountUpOptions {
  duration?: number
  // 小数位，金额类通常需要 0 或 2
  decimals?: number
}

/**
 * 跟随目标值变化做滚动动画。
 * target 为 null / undefined 时返回 null（供模板显示「暂无数据」）。
 */
export const useCountUp = (
  target: Ref<number | null | undefined>,
  options: CountUpOptions = {},
): Ref<number | null> => {
  const duration = options.duration ?? 600
  const decimals = options.decimals ?? 0
  const display = ref<number | null>(null)
  let frame = 0

  const round = (value: number): number => {
    const factor = Math.pow(10, decimals)
    return Math.round(value * factor) / factor
  }

  const animateTo = (to: number): void => {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)

    if (prefersReducedMotion()) {
      display.value = round(to)
      return
    }

    const from = display.value ?? 0
    const start = performance.now()

    const step = (now: number): void => {
      const progress = Math.min((now - start) / duration, 1)
      display.value = round(from + (to - from) * easeOutCubic(progress))
      if (progress < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
  }

  watch(
    target,
    (value) => {
      if (value === null || value === undefined || Number.isNaN(value)) {
        display.value = null
        return
      }
      animateTo(value)
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
  })

  return display
}
