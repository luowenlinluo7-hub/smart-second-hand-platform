/// <reference types="vite/client" />

// 前端环境变量类型声明
// vite/client 已声明 ImportMetaEnv（含任意键的宽松索引签名），
// 这里做接口合并，把用到的变量收窄为明确类型，避免隐式 any。
interface ImportMetaEnv {
  /** 后端地址，仅在跨域部署（如 Vercel 前端 + Railway 后端）时需要配置；本地开发不配，走 Vite 代理 */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
