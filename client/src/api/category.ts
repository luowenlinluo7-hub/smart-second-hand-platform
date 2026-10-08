import { http } from './request'
import type { Category } from '@/types/api'

// 分类列表（筛选用）
export const getCategories = () => http.get<Category[]>('/categories')
