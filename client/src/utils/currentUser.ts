// 当前登录用户 id 的读取工具
//
// 为什么单独抽出来：cart 与 aiChat 两个 store 都需要按用户隔离 localStorage，
// 但它们不能 import auth store —— auth 在 logout 时会回调这两个 store，
// 直接互相 import 会形成循环依赖。这里只读 localStorage 的 `user` 键
// （auth store 写入的同一个键），保持单向依赖。
const USER_KEY = 'user'

export const readCurrentUserId = (): string | null => {
  try {
    const raw = localStorage.getItem(USER_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    const id = (parsed as { id?: unknown }).id
    return typeof id === 'string' && id ? id : null
  } catch {
    // 存储被手动改坏 / 隐私模式不可读时一律当未登录
    return null
  }
}

// 按用户拼接存储键：未登录统一落到 guest，避免多人共用一个浏览器时串数据
export const scopedStorageKey = (prefix: string, userId: string | null): string =>
  `${prefix}:${userId ?? 'guest'}`
