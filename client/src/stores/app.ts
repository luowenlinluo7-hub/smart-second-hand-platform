import { defineStore } from 'pinia'
import { ref } from 'vue'

// 全局应用状态：后端连通性等
export const useAppStore = defineStore('app', () => {
  const online = ref(false)
  const apiPrefix = ref('/api')

  const setOnline = (value: boolean): void => {
    online.value = value
  }

  return { online, apiPrefix, setOnline }
})
