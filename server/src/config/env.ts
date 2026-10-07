import 'dotenv/config';
import { z } from 'zod';

// 环境变量白名单 + 类型转换；任何敏感信息都只能来自 .env，禁止硬编码
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL 不能为空（MySQL 连接串）'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET 至少 16 位'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  // 前端跨域白名单，多个用英文逗号分隔
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  // AI 相关配置仅后端使用，前端永远拿不到
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_API_URL: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  console.error(`[env] 环境变量校验失败：\n${details}`);
  console.error('[env] 请先执行：cp .env.example server/.env，然后按需修改');
  process.exit(1);
}

export const env = parsed.data;

// 跨域白名单数组，便于直接传给 cors()
export const corsOrigins = env.CORS_ORIGIN.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
