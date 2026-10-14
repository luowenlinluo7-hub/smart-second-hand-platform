import { http } from './request'
import type { DashboardData, Product } from '@/types/api'
import type { PageResult } from '@/types/api'

// 管理员：数据看板（全部指标来自真实数据库聚合）
export const getDashboard = (params?: { days?: number }) =>
  http.get<DashboardData>('/admin/dashboard', params as unknown as Record<string, unknown>)

// 管理员：审核队列（可选按 status 过滤）
export const getAuditProducts = (params: { status?: string; page?: number; pageSize?: number }) =>
  http.get<PageResult<Product>>('/admin/products', params as unknown as Record<string, unknown>)

// 管理员：审核通过 / 驳回
export const auditProduct = (id: string, data: { approve: boolean; rejectReason?: string }) =>
  http.patch<Product>(`/admin/products/${id}/audit`, data)
