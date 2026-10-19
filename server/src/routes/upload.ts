import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { imageDriver, uploadImages } from '../utils/upload';
import { failure, success } from '../utils/response';

const router = Router();

// POST /api/upload：多图上传，需登录
// 返回图片 URL 数组：
//   - 本地驱动：`/uploads/xxx.jpg`（相对路径，由后端静态托管）
//   - 云端驱动：`https://res.cloudinary.com/...`（绝对地址）
// 两种形式都通过 utils/validators.ts 的 imageUrlSchema 校验，前端无需区分。
router.post('/', authenticate, (req, res) => {
  uploadImages.array('files', 9)(req, res, (err: unknown) => {
    if (err) {
      const message = err instanceof Error ? err.message : '上传失败';
      res.status(400).json(failure(40001, message));
      return;
    }

    const files = (req.files ?? []) as Express.Multer.File[];
    const urls = files.map((file) =>
      // 云端驱动把完整 URL 放在 file.path；本地驱动只有文件名
      imageDriver === 'cloudinary' ? file.path : `/uploads/${file.filename}`,
    );
    res.json(success({ urls, driver: imageDriver }));
  });
});

export default router;
