# 智能二手交易平台 · 项目上下文合约

## 角色
你是精通 Vue3 + TypeScript + Node.js 的全栈工程师，优先写可维护、类型安全、可部署的代码。

## 技术栈
前端：Vue3 + TypeScript + Vite + Pinia + Vue Router + Element Plus + ECharts + Axios
后端：Node.js + Express + TypeScript + Prisma + MySQL + JWT + zod + bcryptjs
AI：后端调用 DeepSeek-V4.1-Flash，自然语言转 JSON 查询条件
部署：前端 Vercel/Netlify，后端 Railway/Render/云服务器 + PM2 + Nginx，数据库 MySQL
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
server/docs/             数据库与 API 契约文档

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

## 前端设计规范
### 色彩
- 主色：暖橙色 #ff6b35（替代 Element Plus 默认蓝）
- 背景：暖白 #faf9f7（不要纯白 #ffffff）
- 文字：深灰 #1a1a1a / 次级 #666666 / 辅助 #999999

### 间距
- 使用 8 的倍数系统：8 / 16 / 24 / 32 / 48 / 64px
- 卡片内边距 16px，卡片间距 16px，页面边距 16px

### 字体
- 标题使用 "Noto Serif SC"（衬线体，增加品牌感）
- 正文使用 "Noto Sans SC"（非衬线体，保证可读性）
- 禁止使用 Inter、Roboto、Arial

### 圆角与阴影
- 卡片圆角 12px，按钮圆角 8px
- 使用微阴影：0 2px 8px rgba(0,0,0,0.06)
- 悬浮时阴影加深：0 4px 16px rgba(0,0,0,0.1)

### 主题落地方案
> 说明：设计规范必须通过「覆盖 Element Plus CSS 变量」落地，而不是在组件里逐个写死颜色，
> 否则自定义 CSS 与 EP 组件会出现视觉割裂（自定义卡片是橙色、EP 按钮仍是默认蓝）。

- **唯一主题入口**：`client/src/styles/theme.css`（在 `main.ts` 中于 EP 样式之后引入），
  所有品牌色 / 圆角 / 阴影 / 字体统一在此定义，页面组件内不再写死品牌色。
- **主色覆盖**：用 `:root` 覆盖 `--el-color-primary`（及 `--el-color-primary-light-3/5/7/9` 色阶），
  值为暖橙 #ff6b35，使 EP 的按钮 / 链接 / tag / 分页 / 开关等自动变成主题色。
- **背景覆盖**：`--el-bg-color` = #faf9f7（暖白），并同步 `--el-bg-color-overlay` 等衍生变量，
  避免 `el-card` / `el-dialog` 仍出现纯白 #ffffff。
- **文字覆盖**：`--el-text-color-primary` = #1a1a1a、`--el-text-color-regular` = #666666、
  `--el-text-color-secondary` = #999999。
- **圆角覆盖**：`--el-border-radius-base` = 8px（按钮）、卡片圆角 12px 用自定义卡片类实现。
- **字体引入**：使用 npm 本地打包（`@fontsource/noto-serif-sc` + `@fontsource/noto-sans-sc`），
  禁止直连 Google Fonts（国内不可达）；在 theme.css 中声明 `--font-title` 与 `--font-body`，
  标题用衬线、正文用非衬线，并给系统字体 fallback。
- **8 倍数间距只约束自定义布局**（卡片/页面边距、栅格 gap），不强求 EP 组件内部间距。