import type { Request, Response } from 'express';
import { z } from 'zod';
import * as authService from '../services/auth.service';
import { ApiError } from '../utils/ApiError';
import { success } from '../utils/response';
import { imageUrlSchema } from '../utils/validators';

// ---------- zod 校验规则 ----------

const registerSchema = z.object({
  username: z
    .string({ error: '用户名不能为空' })
    .min(3, '用户名至少 3 位')
    .max(30, '用户名最多 30 位')
    .regex(/^[a-zA-Z0-9_]+$/, '用户名只能包含字母、数字、下划线'),
  email: z.string({ error: '邮箱不能为空' }).email('邮箱格式不正确'),
  password: z
    .string({ error: '密码不能为空' })
    .min(8, '密码至少 8 位')
    .regex(/^(?=.*[a-zA-Z])(?=.*\d)/, '密码需同时包含字母和数字'),
  role: z.enum(['USER', 'SELLER']).default('USER'),
});

const loginSchema = z.object({
  account: z.string({ error: '请输入用户名或邮箱' }).min(1, '请输入用户名或邮箱'),
  password: z.string({ error: '请输入密码' }).min(1, '请输入密码'),
});

const profileSchema = z.object({
  nickname: z.string().max(30, '昵称最多 30 字').nullable().optional(),
  // 头像：支持本地上传的相对路径或完整 URL
  avatar: imageUrlSchema.nullable().optional(),
  phone: z
    .string()
    .regex(/^1[3-9]\d{9}$/, '手机号格式不正确')
    .nullable()
    .optional(),
});

const passwordSchema = z
  .object({
    oldPassword: z.string({ error: '请输入原密码' }).min(1, '请输入原密码'),
    newPassword: z
      .string({ error: '请输入新密码' })
      .min(8, '新密码至少 8 位')
      .regex(/^(?=.*[a-zA-Z])(?=.*\d)/, '新密码需同时包含字母和数字'),
  })
  .refine((data) => data.oldPassword !== data.newPassword, {
    message: '新密码不能与原密码相同',
    path: ['newPassword'],
  });

// ---------- 控制器 ----------

// POST /api/auth/register
export const register = async (req: Request, res: Response): Promise<void> => {
  const input = registerSchema.parse(req.body);
  const result = await authService.register(input);
  res.status(201).json(success(result, '注册成功'));
};

// POST /api/auth/login
export const login = async (req: Request, res: Response): Promise<void> => {
  const input = loginSchema.parse(req.body);
  const result = await authService.login(input);
  res.json(success(result, '登录成功'));
};

// GET /api/auth/me（需登录）
export const me = async (req: Request, res: Response): Promise<void> => {
  const user = await authService.getMe(getUserId(req));
  res.json(success(user));
};

// PUT /api/auth/profile（需登录）
export const updateProfile = async (req: Request, res: Response): Promise<void> => {
  const input = profileSchema.parse(req.body);
  const user = await authService.updateProfile(getUserId(req), input);
  res.json(success(user, '资料已更新'));
};

// PUT /api/auth/password（需登录）
export const updatePassword = async (req: Request, res: Response): Promise<void> => {
  const input = passwordSchema.parse(req.body);
  await authService.updatePassword(getUserId(req), input.oldPassword, input.newPassword);
  res.json(success(null, '密码已修改'));
};

// 从 authenticate 中间件注入的 req.user 中取 userId
function getUserId(req: Request): string {
  if (!req.user?.userId) {
    throw ApiError.unauthorized();
  }
  return req.user.userId;
}
