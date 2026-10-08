import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';

// 上传目录：server/uploads（已在 .gitignore 中忽略）
const uploadDir = path.resolve(process.cwd(), 'uploads');

// 确保目录存在（multer 磁盘存储不会自动建目录）
fs.mkdirSync(uploadDir, { recursive: true });

// 允许的图片类型
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    cb(null, name);
  },
});

// 多图上传：字段名 files，最多 9 张，单张 ≤5MB
export const uploadImages = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 9 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new Error('仅支持 jpg / png / webp / gif 图片'));
      return;
    }
    cb(null, true);
  },
});

// 供 app.ts 静态托管使用
export { uploadDir };
