import ElementPlus from 'element-plus'
import { createPinia } from 'pinia'
import { createApp } from 'vue'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'

// 字体走本地打包（@fontsource），不连 Google Fonts，保证国内与断网环境可用。
// 只引需要的字重与 chinese-simplified 子集，避免把整套 CJK（含日韩）字形全部打进包。
import '@fontsource/noto-serif-sc/chinese-simplified-600.css'
import '@fontsource/noto-sans-sc/chinese-simplified-400.css'
import '@fontsource/noto-sans-sc/chinese-simplified-500.css'

import App from './App.vue'
import router from './router'
import './style.css'
// 主题必须在最后引入：它负责覆盖 Element Plus 的默认变量
import './styles/theme.css'

const app = createApp(App)

// 顺序：Pinia -> Router -> Element Plus
app.use(createPinia())
app.use(router)
app.use(ElementPlus, { locale: zhCn })

app.mount('#app')
