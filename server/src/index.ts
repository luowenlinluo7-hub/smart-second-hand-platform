import { createApp } from './app';
import { env } from './config/env';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`[server] 环境: ${env.NODE_ENV}`);
  console.log(`[server] 已启动: http://localhost:${env.PORT}/api/health`);
});

// 优雅退出，避免 nodemon 重启时端口占用
const shutdown = (signal: string): void => {
  console.log(`[server] 收到 ${signal}，正在关闭...`);
  server.close(() => process.exit(0));
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
