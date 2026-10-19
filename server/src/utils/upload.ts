import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { env, isCloudinaryEnabled } from '../config/env';
import { cloudinaryStorage } from './cloudinary';

// 图片上传：
// - 配齐 CLOUDINARY_* 三项凭据 → 走 Cloudinary（适配 Railway / Vercel 这类
//   临时文件系统的部署环境，重启不丢图）
// - 没配 → 走本地磁盘（本地开发、断网答辩、E2E 全部不受影响）
//
// 两种驱动共用同一套 MIME / 扩展名白名单，安全策略不因切换而退化。

// 上传目录：默认 <cwd>/uploads，可用 UPLOAD_DIR 覆盖（演示包中固定在包内）
const uploadDir = env.UPLOAD_DIR
  ? path.resolve(env.UPLOAD_DIR)
  : path.resolve(process.cwd(), 'uploads');

// 只有本地驱动才需要真实目录
if (!isCloudinaryEnabled) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// 允许的图片类型
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

// 扩展名白名单：**落盘的文件名不再取用户上传的扩展名**。
// 若直接沿用 originalname 的扩展名，攻击者可以上传 .html/.svg/.js 并把
// Content-Type 伪造成 image/png，文件会被 express.static 以 text/html 返回，
// 从而获得同源脚本执行能力（可读取 localStorage 里的 JWT）。
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

// 由 MIME 反查一个安全扩展名，彻底与用户输入解耦
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    // 优先用 MIME 映射出的扩展名；映射不到时再退回 originalname，
    // 但仍必须是白名单内的图片扩展名，否则拒绝。
    const fromMime = EXT_BY_MIME[file.mimetype];
    const fromName = path.extname(file.originalname).toLowerCase();
    const ext = fromMime ?? (ALLOWED_EXT.has(fromName) ? fromName : '');
    if (!ext) {
      cb(new Error('仅支持 jpg / png / webp / gif 图片'), '');
      return;
    }
    const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    cb(null, name);
  },
});

// 多图上传：字段名 files，最多 9 张，单张 ≤5MB
export const uploadImages = multer({
  storage: isCloudinaryEnabled ? cloudinaryStorage : diskStorage,
  limits: { fileSize: 5 * 1024 * 1024, files: 9 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new Error('仅支持 jpg / png / webp / gif 图片'));
      return;
    }
    // 扩展名白名单：有扩展名时必须合法（防止 .html / .svg / .js 蒙混过关）。
    // 无扩展名（部分客户端直接给 blob）时不阻断，文件名由服务端决定。
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext && !ALLOWED_EXT.has(ext)) {
      cb(new Error('仅支持 jpg / png / webp / gif 图片'));
      return;
    }
    cb(null, true);
  },
});

// 当前生效的驱动，供启动日志与健康检查观测
export const imageDriver: 'cloudinary' | 'local' = isCloudinaryEnabled ? 'cloudinary' : 'local';

// 供 app.ts 静态托管使用（仅本地驱动下需要注册该路由）
export { uploadDir };
