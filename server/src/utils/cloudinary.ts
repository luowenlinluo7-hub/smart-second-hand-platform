import { v2 as cloudinary, type UploadApiOptions } from 'cloudinary';
import type { Request } from 'express';
import type multer from 'multer';
import path from 'node:path';
import { env, isCloudinaryEnabled } from '../config/env';

// Cloudinary 存储驱动。
//
// 为什么自己写 StorageEngine 而不用 multer-storage-cloudinary：
// 那个包最后一次发布是 2020-05，只 peer-require cloudinary@^1.21，而官方 SDK
// 已到 v2.11；硬装会有 peer 冲突、且没有类型定义。这里用官方 SDK 的
// upload_stream 实现同样的契约（约 70 行），零额外依赖、全程有类型。
//
// 安全要点与本地盘保持一致：
// - MIME 白名单在 upload.ts 的 fileFilter 里已拦截，这里再按 MIME 反查 format
// - public_id 由服务端生成，**不沿用用户文件名**（避免路径注入与伪造扩展名）
// - resource_type 固定为 image，Cloudinary 侧也会按图片处理

if (isCloudinaryEnabled) {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

// MIME → Cloudinary 允许的 format，与本地盘的扩展名白名单保持一致
const FORMAT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** Cloudinary 图片域名，供 CSP 放行使用 */
export const CLOUDINARY_IMAGE_HOST = 'https://res.cloudinary.com';

type HandleFileCallback = (error?: Error | null, info?: Partial<Express.Multer.File>) => void;
type RemoveFileCallback = (error: Error | null) => void;

/** 由原始文件名生成一个安全的 public_id 主体：只留字母数字与连字符 */
const safeNameFrom = (originalname: string): string => {
  const base = path.basename(originalname, path.extname(originalname));
  const cleaned = base.replace(/[^\w-]/g, '').slice(0, 24);
  return cleaned || 'img';
};

export const cloudinaryStorage: multer.StorageEngine = {
  _handleFile(_req: Request, file: Express.Multer.File, cb: HandleFileCallback): void {
    const format = FORMAT_BY_MIME[file.mimetype];
    if (!format) {
      cb(new Error('仅支持 jpg / png / webp / gif 图片'));
      return;
    }

    const options: UploadApiOptions = {
      folder: env.CLOUDINARY_FOLDER,
      resource_type: 'image',
      public_id: `${Date.now()}-${safeNameFrom(file.originalname)}-${Math.random()
        .toString(36)
        .slice(2, 10)}`,
      format,
      overwrite: false,
    };

    // upload_stream 的 error 回调与 stream 的 error 事件可能都触发，
    // 用 settled 保证 multer 的回调只被调用一次
    let settled = false;
    const finish: HandleFileCallback = (error, info) => {
      if (settled) return;
      settled = true;
      cb(error, info);
    };

    const uploadStream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) {
        finish(new Error(`图片上传到云端失败：${error.message}`));
        return;
      }
      if (!result) {
        finish(new Error('图片上传到云端失败：未返回结果'));
        return;
      }
      // info 会与 multer 的 file 合并，路由层直接用 path 作为图片地址
      finish(null, {
        path: result.secure_url,
        filename: result.public_id,
        size: result.bytes,
      });
    });

    // 读取流异常时销毁上传流，避免连接悬挂
    file.stream.on('error', (error: Error) => {
      uploadStream.destroy();
      finish(error);
    });
    file.stream.pipe(uploadStream);
  },

  _removeFile(_req: Request, file: Express.Multer.File, cb: RemoveFileCallback): void {
    // multer 会传入 _handleFile 合并后的 file，filename 即 public_id
    const publicId = file.filename;
    if (!publicId) {
      cb(null);
      return;
    }
    cloudinary.uploader.destroy(
      publicId,
      { resource_type: 'image', invalidate: true },
      (error) => cb(error ?? null),
    );
  },
};
