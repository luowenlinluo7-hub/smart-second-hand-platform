import { http } from './request'
import type { Product, ProductQuery, MyProductListResult } from '@/types/api'
import type { PageResult } from '@/types/api'

// 商品列表（分页 + 筛选）
export const getProducts = (params: ProductQuery) =>
  http.get<PageResult<Product>>('/products', params as unknown as Record<string, unknown>)

// 商品详情
export const getProduct = (id: string) => http.get<Product>(`/products/${id}`)

// 发布商品
export const createProduct = (data: {
  title: string
  description?: string
  price: number
  originalPrice?: number
  images: string[]
  condition: string
  categoryId: string
  stock: number
}) => http.post<Product>('/products', data)

// 编辑商品
export const updateProduct = (
  id: string,
  data: {
    title?: string
    description?: string
    price?: number
    originalPrice?: number
    images?: string[]
    condition?: string
    categoryId?: string
    stock?: number
  },
) => http.put<Product>(`/products/${id}`, data)

// 下架商品
export const deleteProduct = (id: string) => http.delete<null>(`/products/${id}`)

// 重新上架（下架/驳回 → 待审核）
export const relistProduct = (id: string) => http.post<Product>(`/products/${id}/relist`)

// 我的商品（全部状态 + counts）
export const getMyProducts = (params: { status?: string; page?: number; pageSize?: number }) =>
  http.get<MyProductListResult>('/products/mine', params as unknown as Record<string, unknown>)

// 多图上传：返回 URL 数组
export const uploadImages = (files: File[]) => {
  const formData = new FormData()
  files.forEach((file) => formData.append('files', file))
  return http.post<{ urls: string[] }>('/upload', formData)
}
