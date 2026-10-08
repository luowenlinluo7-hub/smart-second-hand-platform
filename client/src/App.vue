<script setup lang="ts">
import { RouterLink, RouterView, useRouter } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'

const appStore = useAppStore()
const authStore = useAuthStore()
const router = useRouter()

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
        <RouterLink to="/dashboard">数据看板</RouterLink>
      </nav>
      <div class="right">
        <el-tag :type="appStore.online ? 'success' : 'danger'" effect="dark" round>
          {{ appStore.online ? '后端已连接' : '后端未连接' }}
        </el-tag>

        <template v-if="authStore.isLoggedIn && authStore.user">
          <el-dropdown>
            <span class="nickname">
              {{ authStore.user.nickname || authStore.user.username }}
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="router.push('/profile')">个人中心</el-dropdown-item>
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
  background: #fff;
  border-bottom: 1px solid var(--el-border-color-light);
}

.brand {
  font-size: 18px;
  font-weight: 600;
  color: #303133;
}

.nav {
  display: flex;
  gap: 16px;
  flex: 1;
}

.nav a {
  color: #606266;
  text-decoration: none;
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
  cursor: pointer;
  color: #303133;
  font-size: 14px;
  outline: none;
}
</style>
