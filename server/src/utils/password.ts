import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

// 密码加密：数据库中只允许存哈希值
export const hashPassword = (plain: string): Promise<string> =>
  bcrypt.hash(plain, SALT_ROUNDS);

// 密码校验
export const verifyPassword = (plain: string, hash: string): Promise<boolean> =>
  bcrypt.compare(plain, hash);
