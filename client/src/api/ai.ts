import { http } from './request'
import type { AiParseResult, AiSearchResult } from '@/types/api'

// AI 自然语言搜索：后端负责调模型、解析条件、再查库，前端只传一句话
export const searchByAi = (data: { query: string; page?: number; pageSize?: number }) =>
  http.post<AiSearchResult>('/ai/search', data)

// 仅解析条件、不查库，便于调试提示词效果
export const parseByAi = (query: string) => http.post<AiParseResult>('/ai/parse', { query })
