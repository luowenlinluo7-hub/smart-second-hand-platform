import axios, { type AxiosInstance } from 'axios'
import type { ApiResponse } from '@/types/api'

// 开发环境走 vite 代理（/api -> http://localhost:3000），因此这里用相对路径
const instance: AxiosInstance = axios.create({
  baseURL: '/api',
  timeout: 15000,
})

// 请求拦截：自动携带 JWT
instance.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 响应拦截：校验 { code, message, data } 信封，非 0 一律当作失败
instance.interceptors.response.use(
  (response) => {
    const body = response.data as ApiResponse<unknown>
    if (body.code !== 0) {
      return Promise.reject(new Error(body.message))
    }
    return response
  },
  (error: unknown) => {
    if (axios.isAxiosError(error)) {
      // 401：会话失效，清除本地 token 与用户信息并跳转登录页
      // （用整页跳转而非 SPA push，确保 Pinia 状态随页面刷新而重建）
      if (error.response?.status === 401) {
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        if (window.location.pathname !== '/login') {
          window.location.assign('/login')
        }
      }
      const body = error.response?.data as ApiResponse<unknown> | undefined
      return Promise.reject(new Error(body?.message ?? error.message))
    }
    return Promise.reject(new Error('网络请求失败'))
  },
)

// 让调用方直接拿到 data（而不是 AxiosResponse），同时保留泛型推导
export const http = {
  get: async <T>(url: string, params?: Record<string, unknown>): Promise<T> => {
    const response = await instance.get<ApiResponse<T>>(url, { params })
    return response.data.data as T
  },
  post: async <T>(url: string, data?: unknown): Promise<T> => {
    const response = await instance.post<ApiResponse<T>>(url, data)
    return response.data.data as T
  },
  patch: async <T>(url: string, data?: unknown): Promise<T> => {
    const response = await instance.patch<ApiResponse<T>>(url, data)
    return response.data.data as T
  },
  put: async <T>(url: string, data?: unknown): Promise<T> => {
    const response = await instance.put<ApiResponse<T>>(url, data)
    return response.data.data as T
  },
  delete: async <T>(url: string): Promise<T> => {
    const response = await instance.delete<ApiResponse<T>>(url)
    return response.data.data as T
  },
}

export default instance
