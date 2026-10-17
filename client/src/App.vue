<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { RouterLink, RouterView, useRouter } from 'vue-router'
import AiAssistant from '@/components/AiAssistant.vue'
import UserAvatar from '@/components/UserAvatar.vue'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { useCartStore } from '@/stores/cart'

const appStore = useAppStore()
const authStore = useAuthStore()
const cartStore = useCartStore()
const router = useRouter()

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

// 头像与首字兜底统一由 UserAvatar 组件处理（含加载失败降级）

const handleLogout = (): void => {
  authStore.logout()
  router.push('/login')
}
</script>

<template>
  <el-container class="layout">
    <el-header class="header">
      <div class="brand">智能二手交易平台</div>
      <nav class="nav">
        <RouterLink to="/">首页</RouterLink>
        <RouterLink v-if="authStore.user?.role === 'ADMIN'" to="/dashboard">数据看板</RouterLink>
        <RouterLink v-if="authStore.isLoggedIn" to="/my-products">我的商品</RouterLink>
        <RouterLink v-if="authStore.isLoggedIn" to="/orders">我的订单</RouterLink>
        <RouterLink v-if="authStore.user?.role === 'SELLER' || authStore.user?.role === 'ADMIN'" to="/publish">
          发布商品
        </RouterLink>
        <RouterLink v-if="authStore.user?.role === 'ADMIN'" to="/admin/products">商品审核</RouterLink>
      </nav>
      <div class="right">
        <el-tag :type="appStore.online ? 'success' : 'danger'" effect="dark" round>
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
              <span class="nickname">{{ displayName }}</span>
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

    <el-main>
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
  gap: 24px;
  background: var(--el-bg-color-overlay);
  border-bottom: 1px solid var(--el-border-color-light);
}

.brand {
  font-family: var(--font-title);
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
  color: var(--el-text-color-primary);
}

.nav {
  display: flex;
  gap: var(--space-1);
  flex: 1;
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
  gap: 12px;
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
</style>
