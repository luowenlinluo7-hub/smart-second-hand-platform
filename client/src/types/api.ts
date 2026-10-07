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
