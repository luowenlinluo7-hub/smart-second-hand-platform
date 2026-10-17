// 状态 → 文案 / tag 类型 的统一映射
//
// 之前这些映射在 6 个视图里各写一遍，改一处要改 6 处，且容易出现
// 「我的商品」把已售显示成浅灰、「订单列表」用另一套标签色这类不一致。
// 这里收敛为单一来源，页面只做引用。
//
// 注意：tag 的语义类型（danger / warning / primary / success / info）
// 保持既有行为不变，仅做去重；配色深浅的调整属于逐页精修范围。

import type { OrderStatus, ProductCondition, ProductStatus } from '@/types/api'

/** el-tag 支持的语义类型 */
export type TagType = 'primary' | 'success' | 'warning' | 'danger' | 'info'

// ---------- 订单状态（6 态） ----------

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_PAYMENT: '待付款',
  PENDING_SHIPMENT: '待发货',
  SHIPPED: '已发货',
  COMPLETED: '已完成',
  REVIEWED: '已评价',
  CANCELLED: '已取消',
}

export const ORDER_STATUS_TAG_TYPE: Record<OrderStatus, TagType> = {
  PENDING_PAYMENT: 'danger',
  PENDING_SHIPMENT: 'warning',
  SHIPPED: 'primary',
  COMPLETED: 'success',
  REVIEWED: 'success',
  CANCELLED: 'info',
}

/** 订单状态筛选下拉选项（含「全部」） */
export const ORDER_STATUS_OPTIONS: { value: '' | OrderStatus; label: string }[] = [
  { value: '', label: '全部' },
  { value: 'PENDING_PAYMENT', label: ORDER_STATUS_LABEL.PENDING_PAYMENT },
  { value: 'PENDING_SHIPMENT', label: ORDER_STATUS_LABEL.PENDING_SHIPMENT },
  { value: 'SHIPPED', label: ORDER_STATUS_LABEL.SHIPPED },
  { value: 'COMPLETED', label: ORDER_STATUS_LABEL.COMPLETED },
  { value: 'REVIEWED', label: ORDER_STATUS_LABEL.REVIEWED },
  { value: 'CANCELLED', label: ORDER_STATUS_LABEL.CANCELLED },
]

// ---------- 商品状态（6 态） ----------

export const PRODUCT_STATUS_LABEL: Record<ProductStatus, string> = {
  DRAFT: '草稿',
  PENDING_REVIEW: '待审核',
  ON_SALE: '在售',
  SOLD: '已售',
  OFF_SHELF: '已下架',
  REJECTED: '已驳回',
}

export const PRODUCT_STATUS_TAG_TYPE: Record<ProductStatus, TagType> = {
  DRAFT: 'info',
  PENDING_REVIEW: 'warning',
  ON_SALE: 'success',
  SOLD: 'info',
  OFF_SHELF: 'info',
  REJECTED: 'danger',
}

/** 我的商品页的 Tab 选项（含「全部」，沿用该页既有的 'ALL' 哨兵值） */
export const PRODUCT_STATUS_TABS: { value: 'ALL' | ProductStatus; label: string }[] = [
  { value: 'ALL', label: '全部' },
  { value: 'PENDING_REVIEW', label: PRODUCT_STATUS_LABEL.PENDING_REVIEW },
  { value: 'ON_SALE', label: PRODUCT_STATUS_LABEL.ON_SALE },
  { value: 'SOLD', label: PRODUCT_STATUS_LABEL.SOLD },
  { value: 'OFF_SHELF', label: PRODUCT_STATUS_LABEL.OFF_SHELF },
  { value: 'REJECTED', label: PRODUCT_STATUS_LABEL.REJECTED },
]

// ---------- 商品成色（4 档） ----------

export const CONDITION_LABEL: Record<ProductCondition, string> = {
  NEW: '全新',
  LIKE_NEW: '几乎全新',
  GOOD: '轻微使用痕迹',
  FAIR: '明显使用痕迹',
}

/** 成色下拉选项（发布 / 筛选共用） */
export const CONDITION_OPTIONS: { value: ProductCondition; label: string }[] = [
  { value: 'NEW', label: CONDITION_LABEL.NEW },
  { value: 'LIKE_NEW', label: CONDITION_LABEL.LIKE_NEW },
  { value: 'GOOD', label: CONDITION_LABEL.GOOD },
  { value: 'FAIR', label: CONDITION_LABEL.FAIR },
]
