import type { Request, Response } from 'express';
import { z } from 'zod';
import { parseQuery } from '../services/ai.service';
import { searchByAi } from '../services/aiSearch.service';
import { success } from '../utils/response';

const querySchema = z
  .string({ error: '请输入搜索内容' })
  .trim()
  .min(1, '请输入搜索内容')
  .max(100, '搜索内容最多 100 字');

const searchSchema = z.object({
  query: querySchema,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
});

const parseSchema = z.object({ query: querySchema });

// POST /api/ai/search —— 自然语言搜索商品
export const search = async (req: Request, res: Response): Promise<void> => {
  const input = searchSchema.parse(req.body);
  const result = await searchByAi(input);
  res.json(success(result));
};

// POST /api/ai/parse —— 只解析条件、不查库，便于调试提示词效果
export const parse = async (req: Request, res: Response): Promise<void> => {
  const input = parseSchema.parse(req.body);
  const outcome = await parseQuery(input.query);
  res.json(success({ parsed: outcome.filters, source: outcome.source, note: outcome.note }));
};
