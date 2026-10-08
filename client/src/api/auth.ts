import { http } from './request'
import type { AuthResult, User, UserRole } from '@/types/api'

// 注册：role 可选，默认 USER
export const register = (data: {
  username: string
  email: string
  password: string
  role?: UserRole
}) => http.post<AuthResult>('/auth/register', data)

// 登录：account 支持用户名或邮箱
export const login = (data: { account: string; password: string }) =>
  http.post<AuthResult>('/auth/login', data)

// 获取当前用户
export const getMe = () => http.get<User>('/auth/me')

// 修改资料：null 表示清空该字段
export const updateProfile = (data: {
  nickname?: string | null
  avatar?: string | null
  phone?: string | null
}) => http.put<User>('/auth/profile', data)

// 修改密码
export const updatePassword = (data: { oldPassword: string; newPassword: string }) =>
  http.put<null>('/auth/password', data)
