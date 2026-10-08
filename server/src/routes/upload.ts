import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { uploadImages } from '../utils/upload';
import { failure, success } from '../utils/response';

const router = Router();

// POST /api/upload：多图上传，需登录；返回图片 URL 数组（相对路径 /uploads/xxx）
router.post('/', authenticate, (req, res) => {
  uploadImages.array('files', 9)(req, res, (err: unknown) => {
    if (err) {
      const message = err instanceof Error ? err.message : '上传失败';
      res.status(400).json(failure(40001, message));
      return;
    }

    const files = (req.files ?? []) as Express.Multer.File[];
    const urls = files.map((file) => `/uploads/${file.filename}`);
    res.json(success({ urls }));
  });
});

export default router;
