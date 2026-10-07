import cors from 'cors';
import express, { type Express } from 'express';
import { corsOrigins } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFound';
import apiRouter from './routes';

// 组装 Express 应用（与启动解耦，便于后续接入测试）
export const createApp = (): Express => {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors({ origin: corsOrigins, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  // 所有业务接口统一挂载在 /api 前缀下
  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
