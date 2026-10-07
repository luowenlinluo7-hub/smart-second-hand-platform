import { http } from './request'
import type { HealthData } from '@/types/api'

// 后端探活，对应 GET /api/health
export const getHealth = () => http.get<HealthData>('/health')
