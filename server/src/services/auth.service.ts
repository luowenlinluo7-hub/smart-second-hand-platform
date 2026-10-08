import type { Prisma } from '@prisma/client';
import { ApiError } from '../utils/ApiError';
import { signToken } from '../utils/jwt';
import { hashPassword, verifyPassword } from '../utils/password';
import { prisma } from '../utils/prisma';

// 对外暴露的用户字段白名单：永远不返回 passwordHash
const publicUserSelect = {
  id: true,
  username: true,
  email: true,
  nickname: true,
  avatar: true,
  phone: true,
  role: true,
  status: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

// 出参用户类型
export type PublicUser = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;

export interface AuthResult {
  token: string;
  user: PublicUser;
}

export interface RegisterInput {
  username: string;
  email: string;
  password: string;
  role: 'USER' | 'SELLER';
}

export interface LoginInput {
  account: string;
  password: string;
}

export interface ProfileInput {
  nickname?: string | null;
  avatar?: string | null;
  phone?: string | null;
}

// 注册：查重 → 哈希 → 写库 → 签发 token
export const register = async (input: RegisterInput): Promise<AuthResult> => {
  const [existingUsername, existingEmail] = await Promise.all([
    prisma.user.findUnique({ where: { username: input.username }, select: { id: true } }),
    prisma.user.findUnique({ where: { email: input.email }, select: { id: true } }),
  ]);

  // 先查重给出友好错误，而不是依赖 P2002 的通用提示
  if (existingUsername) {
    throw ApiError.conflict('用户名已存在');
  }
  if (existingEmail) {
    throw ApiError.conflict('邮箱已注册');
  }

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.user.create({
    data: {
      username: input.username,
      email: input.email,
      passwordHash,
      role: input.role,
      status: 'ACTIVE',
    },
    select: publicUserSelect,
  });

  return { token: signToken({ userId: user.id, role: user.role }), user };
};

// 登录：account 支持用户名或邮箱，错误统一提示避免泄露账号是否存在
export const login = async (input: LoginInput): Promise<AuthResult> => {
  const user = await prisma.user.findFirst({
    where: { OR: [{ username: input.account }, { email: input.account }] },
  });

  if (!user) {
    throw ApiError.unauthorized('账号或密码错误');
  }

  const matched = await verifyPassword(input.password, user.passwordHash);
  if (!matched) {
    throw ApiError.unauthorized('账号或密码错误');
  }

  const publicUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: publicUserSelect,
  });

  return { token: signToken({ userId: user.id, role: user.role }), user: publicUser! };
};

// 获取当前用户
export const getMe = async (userId: string): Promise<PublicUser> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: publicUserSelect,
  });

  if (!user) {
    throw ApiError.unauthorized('用户不存在或已注销');
  }
  return user;
};

// 更新资料：仅 nickname / avatar / phone，null 表示清空
export const updateProfile = async (
  userId: string,
  input: ProfileInput,
): Promise<PublicUser> => {
  const data: Prisma.UserUpdateInput = {};
  if (input.nickname !== undefined) data.nickname = input.nickname;
  if (input.avatar !== undefined) data.avatar = input.avatar;
  if (input.phone !== undefined) data.phone = input.phone;

  return prisma.user.update({
    where: { id: userId },
    data,
    select: publicUserSelect,
  });
};

// 修改密码：校验旧密码 → 哈希新密码 → 更新
export const updatePassword = async (
  userId: string,
  oldPassword: string,
  newPassword: string,
): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });

  if (!user) {
    throw ApiError.unauthorized('用户不存在或已注销');
  }

  const matched = await verifyPassword(oldPassword, user.passwordHash);
  if (!matched) {
    throw ApiError.badRequest('原密码错误');
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
};
