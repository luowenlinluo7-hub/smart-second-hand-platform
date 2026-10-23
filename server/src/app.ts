import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import { corsOrigins, env, isCloudinaryEnabled } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFound';
import apiRouter from './routes';
import { CLOUDINARY_IMAGE_HOST } from './utils/cloudinary';
import { uploadDir } from './utils/upload';

// 前端构建产物目录：默认取同级 client/dist，可用 CLIENT_DIST 覆盖。
// 仅当目录存在时启用同源托管（开发模式下前端由 vite dev server 提供）
const clientDist = env.CLIENT_DIST
  ? path.resolve(env.CLIENT_DIST)
  : path.resolve(process.cwd(), '../client/dist');

// Cloudinary 接口域名：启用云端驱动时，CSP 的 connect-src 需要放行（前端不直传，
// 但保留以免将来改成签名直传时踩坑）
const CLOUDINARY_UPLOAD_HOST = 'https://api.cloudinary.com';

// 允许跨域的来源：
// - CORS_ORIGIN 里的显式域名（开发环境 localhost、生产的固定域名）
// - Vercel 的预览部署域名（形如 <project>-<hash>-<scope>.vercel.app），
//   每次 PR 的 hash 都不同，无法逐个枚举。
//
// 预览域名只放行**本项目**的：项目名从 CORS_ORIGIN 里的 *.vercel.app 反推，
// 避免把「任意人的 vercel.app 部署」都放进来（那等于对全网开放）。
const vercelProjectPrefix = ((): string | null => {
  for (const origin of corsOrigins) {
    const match = /^https:\/\/([a-z0-9-]+)\.vercel\.app$/i.exec(origin);
    if (match) return match[1].toLowerCase();
  }
  return null;
})();

const vercelPreviewPattern = vercelProjectPrefix
  ? new RegExp(`^https://${vercelProjectPrefix}[a-z0-9-]*\\.vercel\\.app$`, 'i')
  : null;

const corsOriginCheck = (
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void => {
  // 无 Origin：curl、服务端到服务端、同源请求
  if (!origin) {
    callback(null, true);
    return;
  }
  if (corsOrigins.includes(origin) || vercelPreviewPattern?.test(origin)) {
    callback(null, true);
    return;
  }
  // 不放行也不抛错：浏览器侧会以「无 CORS 头」的方式拦住，
  // 抛错反而会在服务端日志里堆出大量 500。
  callback(null, false);
};

// 组装 Express 应用（与启动解耦，便于后续接入测试）
export const createApp = (): Express => {
  const app = express();

  app.disable('x-powered-by');

  // 线上位于 Railway 反向代理之后：信任 1 层代理，req.ip 才是真实客户端 IP，
  // 登录 / 注册限流才会按用户分别计数，而不是所有人共用代理 IP 的一个计数。
  if (env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }

  // 安全响应头。指令按本项目的实际资源定制，不能直接用 helmet 默认值：
  // 1) style-src 需要 'unsafe-inline'：Element Plus 大量使用内联 style 属性
  // 2) img-src 需要 data: / blob:：头像占位与 ECharts 导出会用到；
  //    启用 Cloudinary 时还要放行其图片域名，否则上传后的商品图会被 CSP 拦掉
  // 3) font-src 需要 data:：@fontsource 打包的字体走同源，兜底 data:
  // 4) connect-src 需要放行 Cloudinary 上传域名（云端驱动时才加）
  // 5) 关掉 upgrade-insecure-requests：本项目答辩演示包是用 http://<局域网IP>:3000
  //    跑的，UIR 会把资源请求升级成 https 导致整页白屏。生产请在 Nginx 层做 HTTPS 跳转。
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': [
            "'self'",
            'data:',
            'blob:',
            ...(isCloudinaryEnabled ? [CLOUDINARY_IMAGE_HOST] : []),
          ],
          'font-src': ["'self'", 'data:'],
          'connect-src': [
            "'self'",
            ...(isCloudinaryEnabled ? [CLOUDINARY_UPLOAD_HOST] : []),
          ],
          'object-src': ["'none'"],
          'frame-ancestors': ["'none'"],
          'upgrade-insecure-requests': null,
        },
      },
      // 与前端同源托管，资源策略保持 same-origin 即可
      crossOriginResourcePolicy: { policy: 'same-origin' },
    }),
  );

  // CORS：显式白名单 + Vercel 预览域名正则。
  // credentials 必须为 true（前端带 JWT 时虽是 Authorization 头，
  // 但保留它能让 cookie 方案将来也能直接用）。
  app.use(
    cors({
      origin: corsOriginCheck,
      credentials: true,
      // 预检结果缓存 10 分钟，避免每个请求都发 OPTIONS
      maxAge: 600,
      // SSE 的 EventSource 不需要额外暴露头，但限流头对调试有用
      exposedHeaders: ['RateLimit', 'RateLimit-Policy'],
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  // 上传图片静态托管：/uploads/xxx.jpg
  // 仅本地驱动需要；云端驱动下图片直接由 Cloudinary 提供。
  //
  // 安全要点：上传目录与前端同源，因此必须禁止浏览器对文件内容做「嗅探执行」。
  // - nosniff：不按内容猜类型，避免伪装成图片的 HTML 被当页面渲染
  // - CSP sandbox + default-src 'none'：即使被当文档打开，也无法执行脚本 / 加载资源
  if (!isCloudinaryEnabled) {
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
  }

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
