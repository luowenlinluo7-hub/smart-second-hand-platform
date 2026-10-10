import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'

const CART_KEY = 'cart'

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

const readCart = (): CartItem[] => {
  const raw = localStorage.getItem(CART_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as CartItem[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// 本地购物车：Pinia + localStorage，下单时一次性提交 items[]
export const useCartStore = defineStore('cart', () => {
  const items = ref<CartItem[]>(readCart())

  // 任何变更都同步到 localStorage
  watch(
    items,
    (value) => {
      localStorage.setItem(CART_KEY, JSON.stringify(value))
    },
    { deep: true },
  )

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

  return { items, totalCount, totalAmount, groupedBySeller, add, remove, clear, has }
})
