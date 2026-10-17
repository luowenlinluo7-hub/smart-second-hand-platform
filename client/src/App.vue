<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, RouterView, useRouter } from 'vue-router'
import AiAssistant from '@/components/AiAssistant.vue'
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

// 没有头像（或头像加载失败）时，用昵称首字兜底：
// 中文取第一个字，英文转大写首字母，避免出现空白圆圈
const avatarText = computed<string>(() => displayName.value.trim().charAt(0).toUpperCase() || '?')

// 头像地址失效时降级为首字母，避免 header 出现碎图
const avatarBroken = ref(false)
watch(
  () => authStore.user?.avatar,
  () => {
    avatarBroken.value = false
  },
)
const avatarSrc = computed<string | undefined>(() => {
  const url = authStore.user?.avatar
  return url && !avatarBroken.value ? url : undefined
})

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
              <el-avatar
                :size="30"
                :src="avatarSrc"
                class="user-avatar"
                @error="avatarBroken = true"
              >
                {{ avatarText }}
              </el-avatar>
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
  gap: 16px;
  flex: 1;
}

.nav a {
  color: var(--el-text-color-regular);
  text-decoration: none;
  white-space: nowrap;
}

.nav a.router-link-active {
  color: var(--el-color-primary);
  font-weight: 600;
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

.user-avatar {
  flex: 0 0 auto;
  background-color: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-size: 13px;
  font-weight: 600;
}

.menu-role {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
