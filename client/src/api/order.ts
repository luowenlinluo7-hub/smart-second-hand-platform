import { http } from './request'
import type { Order, OrderStatus } from '@/types/api'
import type { PageResult } from '@/types/api'

// 下单：items 由购物车或「立即购买」提供，返回创建的订单数组（按卖家拆单）
export const createOrder = (data: {
  items: { productId: string; quantity: number }[]
  receiverName: string
  receiverPhone: string
  receiverAddress: string
  remark?: string
}) => http.post<Order[]>('/orders', data)

// 买家订单列表
export const getBuyerOrders = (params: { status?: OrderStatus; page?: number; pageSize?: number }) =>
  http.get<PageResult<Order>>('/orders/buyer', params as unknown as Record<string, unknown>)

// 卖家订单列表
export const getSellerOrders = (params: { status?: OrderStatus; page?: number; pageSize?: number }) =>
  http.get<PageResult<Order>>('/orders/seller', params as unknown as Record<string, unknown>)

// 订单详情
export const getOrder = (id: string) => http.get<Order>(`/orders/${id}`)

// 状态流转（付款 / 发货 / 收货 / 取消）
export const updateOrderStatus = (id: string, status: OrderStatus) =>
  http.put<Order>(`/orders/${id}/status`, { status })

// 评价
export const createReviews = (
  id: string,
  reviews: { productId: string; rating: number; content?: string; images?: string[] }[],
) => http.post<Order>(`/orders/${id}/reviews`, { reviews })
