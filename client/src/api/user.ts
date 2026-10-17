import { http } from './request'
import type { SellerProfile } from '@/types/api'

// 卖家公开资料与统计：商品详情页的卖家信息卡使用
export const getUserProfile = (id: string) => http.get<SellerProfile>(`/users/${id}/profile`)
