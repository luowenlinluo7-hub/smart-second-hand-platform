# 智能二手交易平台 · 项目上下文合约

## 角色
你是精通 Vue3 + TypeScript + Node.js 的全栈工程师，优先写可维护、类型安全、可部署的代码。

## 技术栈
前端：Vue3 + TypeScript + Vite + Pinia + Vue Router + Element Plus + ECharts + Axios
后端：Node.js + Express + TypeScript + Prisma + MySQL + JWT + zod + bcryptjs
AI：后端调用 DeepSeek-V4.1-Flash，自然语言转 JSON 查询条件
部署：前端 Vercel/Netlify，后端 Railway/Render/云服务器 + PM2 + Nginx，数据库 Supabase/MySQL
版本：GitHub 主仓库，Gitee 镜像

## 目录约定
client/src/views/        页面
client/src/components/   组件
client/src/api/          接口封装
client/src/types/        类型定义
client/src/stores/       Pinia
server/src/routes/       路由
server/src/controllers/  控制器
server/src/middleware/   中间件
server/src/services/     业务服务
server/src/utils/        工具
server/prisma/           Prisma schema

## 不可违反
1. 前端只用 `<script setup lang="ts">`，禁止 any。
2. 所有接口返回 `{ code, message, data }`。
3. 密码必须 bcryptjs 加密。
4. 数据库必须 Prisma 参数化，禁止拼接 SQL。
5. JWT Secret、数据库密码、AI Key 全部放 .env。
6. AI Key 不得出现在前端代码或公开仓库。
7. 新文件必须放正确目录。
8. 完成任务后给出：文件清单、关键代码、启动命令、验收自测、回退方案。

## 完成定义
- TypeScript 无编译错误
- 前端 npm run dev 无报错
- 后端 npm run dev 无报错
- 涉及数据库需给 Prisma schema 变更和迁移命令
- 接口需给 curl 示例