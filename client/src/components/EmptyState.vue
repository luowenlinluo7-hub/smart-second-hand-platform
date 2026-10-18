<script setup lang="ts">
import type { Component } from 'vue'

// 全站统一的空状态。
// 为什么不用 el-empty：它的默认插画是灰阶的、且各页 image-size 不一致，
// 视觉上像「白板一块」；这里改成品牌化的圆形淡橙底 + 主色图标，
// 并强制带上「下一步该做什么」的说明与可选 CTA。
withDefaults(
  defineProps<{
    title: string
    /** 补充说明：告诉用户为什么空、怎么才能有内容 */
    description?: string
    /** 主色图标（来自 @element-plus/icons-vue）；不传则只显示圆点装饰 */
    icon?: Component
    /** 传入则渲染行动按钮 */
    actionText?: string
    /** 紧凑模式：用于看板图表、评价区这类高度受限的容器 */
    compact?: boolean
  }>(),
  {
    description: '',
    icon: undefined,
    actionText: '',
    compact: false,
  },
)

const emit = defineEmits<{ action: [] }>()
</script>

<template>
  <div class="empty-state" :class="{ 'is-compact': compact }">
    <div class="empty-icon">
      <el-icon v-if="icon"><component :is="icon" /></el-icon>
    </div>
    <p class="empty-title">{{ title }}</p>
    <p v-if="description" class="empty-desc">{{ description }}</p>
    <el-button v-if="actionText" type="primary" plain class="empty-action" @click="emit('action')">
      {{ actionText }}
    </el-button>
    <!-- 需要更复杂的操作时，页面可通过默认插槽接管按钮区 -->
    <slot />
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: var(--space-5) var(--space-2);
  text-align: center;
}

.empty-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background-color: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-size: 30px;
}

.empty-title {
  margin: var(--space-2) 0 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.empty-desc {
  margin: var(--space-1) 0 0;
  max-width: 360px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.empty-action {
  margin-top: var(--space-2);
}

/* 紧凑模式：图表卡 / 评价区里不需要那么大留白 */
.is-compact {
  padding: var(--space-3) var(--space-2);
}

.is-compact .empty-icon {
  width: 48px;
  height: 48px;
  font-size: 22px;
}

.is-compact .empty-title {
  margin-top: var(--space-1);
  font-size: 13px;
  font-weight: 500;
  color: var(--el-text-color-regular);
}

.is-compact .empty-desc {
  font-size: 12px;
}
</style>
