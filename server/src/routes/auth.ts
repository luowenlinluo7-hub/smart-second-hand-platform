import { Router } from 'express';
import * as authController from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth';
import { loginLimiter, registerLimiter } from '../middleware/rateLimit';

const router = Router();

// 公开（带失败次数限流：登录严格防爆破，注册宽松防刷号）
router.post('/register', registerLimiter, authController.register);
router.post('/login', loginLimiter, authController.login);

// 需登录
router.get('/me', authenticate, authController.me);
router.put('/profile', authenticate, authController.updateProfile);
router.put('/password', authenticate, authController.updatePassword);

export default router;
