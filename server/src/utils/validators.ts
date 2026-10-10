import { z } from 'zod';

// 图片地址校验：允许两种形式
//   1) 本地上传返回的相对路径  /uploads/xxx.jpg
//   2) 外部完整链接              https://example.com/a.jpg
// 注意：不能用 z.string().url()，它要求完整协议，会拒绝本地上传的相对路径。
export const imageUrlSchema = z
  .string()
  .trim()
  .min(1, '图片地址不能为空')
  .refine((value) => /^\/uploads\/[\w.-]+$/.test(value) || /^https?:\/\/\S+$/i.test(value), {
    message: '图片地址必须是上传路径（/uploads/...）或 http(s) 链接',
  });

// 图片地址数组（最多 9 张）
export const imageUrlListSchema = z.array(imageUrlSchema).max(9, '最多 9 张图片');
