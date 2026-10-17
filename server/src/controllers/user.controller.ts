import type { Request, Response } from 'express';
import * as userService from '../services/user.service';
import { success } from '../utils/response';

// GET /api/users/:id/profile —— 卖家公开资料与统计（公开接口）
export const profile = async (req: Request, res: Response): Promise<void> => {
  const data = await userService.getPublicProfile(String(req.params.id));
  res.json(success(data));
};
