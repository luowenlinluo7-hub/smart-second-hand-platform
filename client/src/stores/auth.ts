import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { getMe } from '@/api/auth'
import type { AuthResult, User } from '@/types/api'

const TOKEN_KEY = 'token'
const USER_KEY = 'user'

// 从 localStorage 恢复用户信息（可能因格式异常而失败）
const readUser = (): User | null => {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as User
  } catch {
    return null
  }
}

// 认证状态：token 持久化到 localStorage，刷新后自动恢复
export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem(TOKEN_KEY))
  const user = ref<User | null>(readUser())

  const isLoggedIn = computed(() => !!token.value)

  // 登录 / 注册成功后写入
  const setAuth = (auth: AuthResult): void => {
    token.value = auth.token
    user.value = auth.user
    localStorage.setItem(TOKEN_KEY, auth.token)
    localStorage.setItem(USER_KEY, JSON.stringify(auth.user))
  }

  // 退出登录：清空内存与本地存储
  const logout = (): void => {
    token.value = null
    user.value = null
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
  }

  // 拉取最新用户信息（Profile 页进入时调用）
  const fetchMe = async (): Promise<void> => {
    try {
      user.value = await getMe()
      localStorage.setItem(USER_KEY, JSON.stringify(user.value))
    } catch {
      // 401 已由拦截器处理并跳转，这里兜底清空本地态
      logout()
    }
  }

  return { token, user, isLoggedIn, setAuth, logout, fetchMe }
})
