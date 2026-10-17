<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, RouterView, useRouter } from 'vue-router'
import { Menu } from '@element-plus/icons-vue'
import AiAssistant from '@/components/AiAssistant.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import { useIsMobile } from '@/composables/useIsMobile'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { useCartStore } from '@/stores/cart'

const appStore = useAppStore()
const authStore = useAuthStore()
const cartStore = useCartStore()
const router = useRouter()
const { isMobile } = useIsMobile()

// 移动端导航抽屉
const navOpen = ref(false)

// 全局探活：任何页面进入都更新一次后端连通状态，保证导航栏标签准确
onMounted(() => {
  appStore.checkOnline()
})

const displayName = computed<string>(
  () => authStore.user?.nickname || authStore.user?.username || '',
)

// 账号角色，展示在下拉菜单顶部，方便多角色切换时确认当前身份
const roleLabel = computed<string>(() => {
  switch (authStore.user?.role) {
    case 'ADMIN':
      return '管理员'
    case 'SELLER':
      return '卖家'
    case 'USER':
      return '普通用户'
    default:
      return ''
  }
})

// 导航项数据化：桌面横向渲染、移动端抽屉里纵向渲染，避免两处维护同一份规则
const navLinks = computed<{ to: string; label: string }[]>(() => {
  const links: { to: string; label: string }[] = [{ to: '/', label: '首页' }]
  if (authStore.user?.role === 'ADMIN') links.push({ to: '/dashboard', label: '数据看板' })
  if (authStore.isLoggedIn) links.push({ to: '/my-products', label: '我的商品' })
  if (authStore.isLoggedIn) links.push({ to: '/orders', label: '我的订单' })
  if (authStore.user?.role === 'SELLER' || authStore.user?.role === 'ADMIN') {
    links.push({ to: '/publish', label: '发布商品' })
  }
  if (authStore.user?.role === 'ADMIN') links.push({ to: '/admin/products', label: '商品审核' })
  return links
})

// 点击抽屉里的导航后自动收起
const onNavigate = (): void => {
  navOpen.value = false
}

const handleLogout = (): void => {
  authStore.logout()
  navOpen.value = false
  router.push('/login')
}
</script>

<template>
  <el-container class="layout">
    <el-header class="header">
      <!-- 移动端：汉堡菜单入口 -->
      <button
        v-if="isMobile"
        type="button"
        class="nav-toggle"
        aria-label="打开导航菜单"
        @click="navOpen = true"
      >
        <el-icon :size="20"><Menu /></el-icon>
      </button>

      <div class="brand">智能二手交易平台</div>

      <!-- 桌面：横向导航 -->
      <nav v-if="!isMobile" class="nav">
        <RouterLink v-for="link in navLinks" :key="link.to" :to="link.to">
          {{ link.label }}
        </RouterLink>
      </nav>

      <div class="right">
        <!-- 后端连通状态属于开发期信息，移动端隐藏以节省横向空间 -->
        <el-tag v-if="!isMobile" :type="appStore.online ? 'success' : 'danger'" effect="dark" round>
          {{ appStore.online ? '后端已连接' : '后端未连接' }}
        </el-tag>

        <el-badge
          v-if="authStore.isLoggedIn"
          :value="cartStore.totalCount"
          :hidden="cartStore.totalCount === 0"
        >
          <el-button text @click="router.push('/cart')">购物车</el-button>
        </el-badge>

        <template v-if="authStore.isLoggedIn && authStore.user">
          <el-dropdown trigger="click">
            <button type="button" class="user-trigger">
              <UserAvatar :src="authStore.user.avatar" :name="displayName" :size="30" />
              <span v-if="!isMobile" class="nickname">{{ displayName }}</span>
            </button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item disabled>
                  <span class="menu-role">{{ roleLabel }}</span>
                </el-dropdown-item>
                <el-dropdown-item divided @click="router.push('/profile')">
                  个人中心
                </el-dropdown-item>
                <el-dropdown-item @click="router.push('/orders')">我的订单</el-dropdown-item>
                <el-dropdown-item @click="router.push('/cart')">购物车</el-dropdown-item>
                <el-dropdown-item divided @click="handleLogout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </template>

        <template v-else>
          <el-button text @click="router.push('/login')">登录</el-button>
          <el-button type="primary" @click="router.push('/register')">注册</el-button>
        </template>
      </div>
    </el-header>

    <!-- 移动端导航抽屉 -->
    <el-drawer
      v-model="navOpen"
      :size="280"
      direction="ltr"
      title="导航"
      class="nav-drawer"
    >
      <nav class="nav-vertical">
        <RouterLink
          v-for="link in navLinks"
          :key="link.to"
          :to="link.to"
          @click="onNavigate"
        >
          {{ link.label }}
        </RouterLink>
      </nav>
      <template v-if="authStore.isLoggedIn && authStore.user" #footer>
        <el-button text @click="router.push('/profile'); onNavigate()">个人中心</el-button>
        <el-button text type="danger" @click="handleLogout">退出登录</el-button>
      </template>
    </el-drawer>

    <el-main class="app-main">
      <RouterView />
    </el-main>

    <!-- 全局 AI 导购助手：挂在布局层，因此切换页面时对话记录不会丢失 -->
    <AiAssistant />
  </el-container>
</template>

<style scoped>
.layout {
  min-height: 100vh;
}

.header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  /* 允许子项收缩：否则品牌 + nav 的 nowrap 内容会把 header 撑出屏幕 */
  min-width: 0;
  background: var(--el-bg-color-overlay);
  border-bottom: 1px solid var(--el-border-color-light);
}

/* 汉堡按钮：移动端入口，点击区不小于 44px */
.nav-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: var(--tap-target);
  height: var(--tap-target);
  margin-left: calc(var(--space-1) * -1);
  padding: 0;
  border: none;
  border-radius: var(--el-border-radius-base);
  background: transparent;
  color: var(--el-text-color-primary);
  cursor: pointer;
}

.nav-toggle:hover {
  background-color: var(--el-fill-color-light);
}

.brand {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-title);
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--el-text-color-primary);
}

.nav {
  display: flex;
  gap: var(--space-1);
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

/* 导航项：字重与字号略加强，避免短词显得单薄；
   激活态除了主色文字，再用底部 2px 短下划线做形状区分
   （只靠颜色区分对色觉障碍不友好） */
.nav a {
  position: relative;
  padding: 6px 8px;
  border-radius: var(--el-border-radius-base);
  color: var(--el-text-color-regular);
  font-size: 15px;
  font-weight: 500;
  letter-spacing: 0.01em;
  text-decoration: none;
  white-space: nowrap;
  transition:
    color 0.2s ease,
    background-color 0.2s ease;
}

.nav a:hover {
  color: var(--el-color-primary);
  background-color: var(--el-color-primary-light-9);
}

.nav a.router-link-active {
  color: var(--el-color-primary);
  font-weight: 600;
}

.nav a.router-link-active::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: 0;
  width: 18px;
  height: 2px;
  border-radius: 2px;
  background-color: var(--el-color-primary);
  transform: translateX(-50%);
}

.right {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  gap: var(--space-1);
}

/* 主内容区内边距走 token，移动端由 theme.css 的 --main-padding 收窄 */
.app-main {
  padding: var(--main-padding);
  /* 底部留白：避免 AI 悬浮球遮住页面最后一个操作按钮 */
  padding-bottom: var(--space-6);
}

/* 移动端导航抽屉里的竖排菜单 */
.nav-vertical {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.nav-vertical a {
  display: block;
  padding: var(--space-2);
  border-radius: var(--el-border-radius-base);
  color: var(--el-text-color-regular);
  font-size: 15px;
  font-weight: 500;
  text-decoration: none;
}

.nav-vertical a:hover {
  background-color: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

.nav-vertical a.router-link-active {
  background-color: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: 600;
}

.nickname {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--el-text-color-primary);
  font-size: 14px;
}

/* 头像 + 昵称组成的下拉触发器。
   用 button 是为了让键盘可聚焦（原生 span 不可 Tab），同时清掉浏览器按钮样式 */
.user-trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: 4px 8px 4px 4px;
  border: none;
  border-radius: var(--el-border-radius-round);
  background: transparent;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.user-trigger:hover {
  background-color: var(--el-fill-color-light);
}

.user-trigger:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}

.menu-role {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

/* ---------- 移动端 ---------- */
@media (max-width: 767px) {
  /* 移动端悬浮球更靠下，主内容底部留白相应加大，保证最后一个按钮可点 */
  .app-main {
    padding-bottom: calc(var(--space-6) + var(--space-2));
  }

  /* 品牌名在窄屏缩小一号并去掉字距，避免被省略号截成「智能二手交易…」 */
  .brand {
    font-size: 15px;
    letter-spacing: 0;
  }
}
</style>
