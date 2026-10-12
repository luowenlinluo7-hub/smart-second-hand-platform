import { z } from 'zod';

// 站内静态资源路径：只允许平台自己的两个目录，且只允许单层文件名
//   /uploads/xxx.jpg —— 用户上传的图片
//   /demo/p1.jpg     —— 平台内置的示例图（seed 数据用它，保证断网时不裂图）
const LOCAL_IMAGE_PATH = /^\/(?:uploads|demo)\/[\w.-]+$/;

// 图片地址校验：允许两种形式
//   1) 站内相对路径  /uploads/xxx.jpg 或 /demo/p1.jpg
//   2) 外部完整链接  https://example.com/a.jpg
// 注意：不能用 z.string().url()，它要求完整协议，会拒绝站内相对路径。
export const imageUrlSchema = z
  .string()
  .trim()
  .min(1, '图片地址不能为空')
  .refine((value) => LOCAL_IMAGE_PATH.test(value) || /^https?:\/\/\S+$/i.test(value), {
    message: '图片地址必须是站内路径（/uploads/... 或 /demo/...）或 http(s) 链接',
  });

// 图片地址数组（最多 9 张）
export const imageUrlListSchema = z.array(imageUrlSchema).max(9, '最多 9 张图片');
