import ElementPlus from 'element-plus'
import { createPinia } from 'pinia'
import { createApp } from 'vue'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'

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
