// 与后端约定的统一响应体：{ code, message, data }
export interface ApiResponse<T = null> {
  code: number
  message: string
  data: T | null
}

// GET /api/health 的 data 结构
export interface HealthData {
  status: string
  service: string
  uptime: number
  timestamp: string
}

// 列表类接口的分页信封
export interface PageResult<T> {
  list: T[]
  total: number
  page: number
  pageSize: number
}

// 用户角色
export type UserRole = 'USER' | 'SELLER' | 'ADMIN'

// 用户出参（后端已排除 passwordHash）
export interface User {
  id: string
  username: string
  email: string
  nickname: string | null
  avatar: string | null
  phone: string | null
  role: UserRole
  status: string
  createdAt: string
}

// 注册 / 登录的返回数据
export interface AuthResult {
  token: string
  user: User
}
