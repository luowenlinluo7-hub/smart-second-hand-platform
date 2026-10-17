import cors from 'cors';
import express, { type Express } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { corsOrigins, env } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFound';
import apiRouter from './routes';
import { uploadDir } from './utils/upload';

// 前端构建产物目录：默认取同级 client/dist，可用 CLIENT_DIST 覆盖。
// 仅当目录存在时启用同源托管（开发模式下前端由 vite dev server 提供）
const clientDist = env.CLIENT_DIST
  ? path.resolve(env.CLIENT_DIST)
  : path.resolve(process.cwd(), '../client/dist');

// 组装 Express 应用（与启动解耦，便于后续接入测试）
export const createApp = (): Express => {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors({ origin: corsOrigins, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  // 上传图片静态托管：/uploads/xxx.jpg
  // 安全要点：上传目录与前端同源，因此必须禁止浏览器对文件内容做「嗅探执行」。
  // - nosniff：不按内容猜类型，避免伪装成图片的 HTML 被当页面渲染
  // - CSP sandbox + default-src 'none'：即使被当文档打开，也无法执行脚本 / 加载资源
  app.use(
    '/uploads',
    express.static(path.resolve(uploadDir), {
      index: false,
      dotfiles: 'deny',
      setHeaders: (res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      },
    }),
  );

  // 所有业务接口统一挂载在 /api 前缀下
  app.use('/api', apiRouter);

  // 生产 / 答辩演示：后端同源托管前端构建产物
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));

    // SPA 路由回落：非 /api、非 /uploads 的 GET 请求返回 index.html
    // 用中间件而非 app.get('*')，因为 Express 5 已不再支持该通配写法
    app.use((req, res, next) => {
      if (
        req.method !== 'GET' ||
        req.path.startsWith('/api') ||
        req.path.startsWith('/uploads')
      ) {
        next();
        return;
      }
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
