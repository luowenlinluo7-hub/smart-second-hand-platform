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

// 商品成色
export type ProductCondition = 'NEW' | 'LIKE_NEW' | 'GOOD' | 'FAIR'

// 商品状态
export type ProductStatus =
  | 'DRAFT'
  | 'PENDING_REVIEW'
  | 'ON_SALE'
  | 'SOLD'
  | 'OFF_SHELF'
  | 'REJECTED'

// 商品（含卖家与分类嵌套）
export interface Product {
  id: string
  title: string
  description: string | null
  price: string
  originalPrice: string | null
  images: string[]
  condition: ProductCondition
  status: ProductStatus
  stock: number
  viewCount: number
  favoriteCount: number
  publishedAt: string | null
  sellerId: string
  categoryId: string
  createdAt: string
  updatedAt: string
  seller: {
    id: string
    username: string
    nickname: string | null
    avatar: string | null
  }
  category: {
    id: string
    name: string
    slug: string
  }
}

// 商品列表查询参数
export interface ProductQuery {
  categoryId?: string
  condition?: ProductCondition
  priceMin?: number
  priceMax?: number
  keyword?: string
  page?: number
  pageSize?: number
}

// 卖家「我的商品」查询结果：额外带各状态数量
export interface MyProductListResult extends PageResult<Product> {
  counts: Record<ProductStatus, number>
}

// 分类
export interface Category {
  id: string
  name: string
  slug: string
  icon: string | null
  sortOrder: number
  status: string
}

// 订单状态
export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PENDING_SHIPMENT'
  | 'SHIPPED'
  | 'COMPLETED'
  | 'REVIEWED'
  | 'CANCELLED'

// 订单明细（下单快照）
export interface OrderItem {
  id: string
  orderId: string
  productId: string
  title: string
  image: string | null
  price: string
  quantity: number
  subtotal: string
  status: string
  createdAt: string
}

// 订单参与方简要信息
export interface OrderUserBrief {
  id: string
  username: string
  nickname: string | null
  avatar: string | null
}

// 订单
export interface Order {
  id: string
  orderNo: string
  buyerId: string
  sellerId: string
  totalAmount: string
  status: OrderStatus
  receiverName: string
  receiverPhone: string
  receiverAddress: string
  remark: string | null
  paidAt: string | null
  shippedAt: string | null
  completedAt: string | null
  reviewedAt: string | null
  cancelledAt: string | null
  createdAt: string
  updatedAt: string
  items: OrderItem[]
  buyer: OrderUserBrief
  seller: OrderUserBrief
}
