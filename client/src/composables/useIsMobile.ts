import { onBeforeUnmount, onMounted, ref } from 'vue'

// 移动端断点：与 Element Plus 的 :xs 一致（< 768px 视为移动端）。
//
// 为什么需要 JS 侧的判断：有些响应式不是「换个 CSS 值」能解决的 ——
// el-form 的 label-position、el-drawer 的 size、el-steps 的 direction
// 都是组件 props，只能在 JS 里决定。
//
// 注意：CSS 媒体查询的断点值无法用 CSS 变量（规范限制），
// 所以这里的 767 与各组件 <style> 里的 @media 必须保持一致。
const MOBILE_QUERY = '(max-width: 767px)'

export const useIsMobile = () => {
  const isMobile = ref(false)
  let mediaQuery: MediaQueryList | null = null
  let onChange: ((event: MediaQueryListEvent) => void) | null = null

  onMounted(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    mediaQuery = window.matchMedia(MOBILE_QUERY)
    isMobile.value = mediaQuery.matches

    onChange = (event) => {
      isMobile.value = event.matches
    }
    // Safari 14 以下只支持 addListener，这里做兼容
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', onChange)
    } else {
      mediaQuery.addListener(onChange)
    }
  })

  onBeforeUnmount(() => {
    if (!mediaQuery || !onChange) return
    if (typeof mediaQuery.removeEventListener === 'function') {
      mediaQuery.removeEventListener('change', onChange)
    } else {
      mediaQuery.removeListener(onChange)
    }
    mediaQuery = null
    onChange = null
  })

  return { isMobile }
}
