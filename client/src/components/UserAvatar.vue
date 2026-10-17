<script setup lang="ts">
import { computed, ref, watch } from 'vue'

// 统一头像：有图显示图，无图或加载失败时用名字首字兜底。
// 全站（header / 商品详情卖家卡 / 评价列表 / 订单）共用，避免各处重复写降级逻辑。
const props = withDefaults(
  defineProps<{
    src?: string | null
    // 用于生成兜底文字，通常传昵称或用户名
    name?: string | null
    size?: number
    // 兜底文字的底色，默认为品牌浅色；用于区分不同角色时可覆盖
    round?: boolean
  }>(),
  { src: null, name: '', size: 32, round: true },
)

const broken = ref(false)

// 换人 / 换图时重置失效标记，否则一次失败会永久降级
watch(
  () => props.src,
  () => {
    broken.value = false
  },
)

const currentSrc = computed<string | undefined>(() =>
  props.src && !broken.value ? props.src : undefined,
)

// 中文取第一个字，英文取首字母大写
const initial = computed<string>(() => {
  const text = (props.name ?? '').trim()
  if (!text) return '?'
  return text.charAt(0).toUpperCase()
})

const boxStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  borderRadius: props.round ? '50%' : '8px',
  fontSize: `${Math.max(11, Math.round(props.size * 0.42))}px`,
}))
</script>

<template>
  <el-avatar
    :size="size"
    :src="currentSrc"
    :style="boxStyle"
    class="user-avatar"
    @error="broken = true"
  >
    {{ initial }}
  </el-avatar>
</template>

<style scoped>
.user-avatar {
  flex: 0 0 auto;
  background-color: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: 600;
  user-select: none;
}
</style>
