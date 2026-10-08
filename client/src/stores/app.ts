import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getHealth } from '@/api/health'

// 全局应用状态：后端连通性等
export const useAppStore = defineStore('app', () => {
  const online = ref(false)
  const apiPrefix = ref('/api')

  const setOnline = (value: boolean): void => {
    online.value = value
  }

  // 静默探活：只更新 online 状态，不弹 toast（供 App 全局挂载时调用）
  const checkOnline = async (): Promise<void> => {
    try {
      await getHealth()
      setOnline(true)
    } catch {
      setOnline(false)
    }
  }

  return { online, apiPrefix, setOnline, checkOnline }
})
