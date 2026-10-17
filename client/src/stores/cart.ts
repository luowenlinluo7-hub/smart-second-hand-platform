import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { readCurrentUserId, scopedStorageKey } from '@/utils/currentUser'

// 存储键按用户隔离：换账号登录时不会看到上一个人的购物车。
// 旧版本用的是全局 'cart' 键，已废弃（switchUser 时会清理）。
const CART_KEY_PREFIX = 'cart'
const LEGACY_CART_KEY = 'cart'

// 购物车条目：冗余商品信息，便于购物车直接展示（不额外请求）
export interface CartItem {
  productId: string
  title: string
  price: string
  image: string | null
  sellerId: string
  sellerName: string
  quantity: number
}

const readCart = (key: string): CartItem[] => {
  const raw = localStorage.getItem(key)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as CartItem[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// 本地购物车：Pinia + localStorage（按用户隔离），下单时一次性提交 items[]
export const useCartStore = defineStore('cart', () => {
  // 初始归属用户：刷新页面时直接命中当前登录用户自己的购物车
  let ownerId: string | null = readCurrentUserId()

  const storageKey = (): string => scopedStorageKey(CART_KEY_PREFIX, ownerId)

  const items = ref<CartItem[]>(readCart(storageKey()))

  // 任何变更都同步到 localStorage（写入当前归属用户的键）
  watch(
    items,
    (value) => {
      try {
        localStorage.setItem(storageKey(), JSON.stringify(value))
      } catch {
        // 超出配额 / 隐私模式：不影响内存中的购物车
      }
    },
    { deep: true },
  )

  // 切换账号（登录 / 退出）：先清空内存，再载入目标用户自己的购物车。
  // 退出登录后落到 guest 空间，因此页面上不会再显示上一个账号的商品。
  const switchUser = (nextUserId: string | null): void => {
    if (nextUserId === ownerId) return
    ownerId = nextUserId
    items.value = readCart(storageKey())
    // 清理旧版本遗留的全局键，避免升级后仍残留别人的购物车
    try {
      localStorage.removeItem(LEGACY_CART_KEY)
    } catch {
      // 忽略
    }
  }

  const totalCount = computed(() => items.value.reduce((sum, i) => sum + i.quantity, 0))

  const totalAmount = computed(() =>
    items.value.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0).toFixed(2),
  )

  // 按卖家分组，便于按卖家拆单展示与提交
  const groupedBySeller = computed(() => {
    const groups = new Map<string, { sellerId: string; sellerName: string; items: CartItem[] }>()
    for (const item of items.value) {
      const group = groups.get(item.sellerId) ?? {
        sellerId: item.sellerId,
        sellerName: item.sellerName,
        items: [],
      }
      group.items.push(item)
      groups.set(item.sellerId, group)
    }
    return [...groups.values()]
  })

  const add = (item: Omit<CartItem, 'quantity'>, quantity = 1): void => {
    const existing = items.value.find((i) => i.productId === item.productId)
    if (existing) {
      // 二手商品单件，重复加入只累积到 1
      existing.quantity = Math.min(existing.quantity + quantity, 1)
      return
    }
    items.value.push({ ...item, quantity })
  }

  const remove = (productId: string): void => {
    items.value = items.value.filter((i) => i.productId !== productId)
  }

  const clear = (): void => {
    items.value = []
  }

  const has = (productId: string): boolean => items.value.some((i) => i.productId === productId)

  return { items, totalCount, totalAmount, groupedBySeller, add, remove, clear, has, switchUser }
})
