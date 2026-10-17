<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useIsMobile } from '@/composables/useIsMobile'
import { useAiChatStore, type AiChatMessage } from '@/stores/aiChat'

const router = useRouter()
const chat = useAiChatStore()
const { isMobile } = useIsMobile()

const input = ref('')
const scrollRef = ref<HTMLElement | null>(null)

const canSend = computed(() => input.value.trim().length > 0 && !chat.isStreaming)

const onSend = async (): Promise<void> => {
  if (!canSend.value) return
  const text = input.value
  input.value = ''
  await chat.send(text)
}

// 点建议词等同于用户自己输入
const onSuggestion = async (text: string): Promise<void> => {
  if (chat.isStreaming) return
  await chat.send(text)
}

const goProduct = (id: string): void => {
  chat.close()
  router.push(`/products/${id}`)
}

const sourceText = (message: AiChatMessage): string => {
  switch (message.source) {
    case 'ai':
      return 'AI 解析'
    case 'mock':
      return '本地规则'
    case 'fallback':
      return '已降级'
    default:
      return ''
  }
}

// 新消息或流式内容增长时自动滚到底部
const scrollToBottom = async (): Promise<void> => {
  await nextTick()
  const el = scrollRef.value
  if (el) el.scrollTop = el.scrollHeight
}

watch(
  () => [
    chat.messages.length,
    chat.messages[chat.messages.length - 1]?.content.length ?? 0,
    chat.messages[chat.messages.length - 1]?.thoughts.length ?? 0,
  ],
  scrollToBottom,
)

watch(
  () => chat.drawerOpen,
  (open) => {
    if (open) scrollToBottom()
  },
)
</script>

<template>
  <!-- 悬浮入口
       外层 anchor 只承担「一次性入场动画」，内层 button 承担 hover ——
       两者都要改 transform，分成两层才能避免 animation 把 hover 的位移覆盖掉 -->
  <div v-show="!chat.drawerOpen" class="ai-fab-anchor">
    <el-tooltip content="AI 导购助手" placement="left" :show-after="200">
      <button
        class="ai-fab"
        type="button"
        :aria-label="chat.unreadCount > 0 ? 'AI 导购助手（有新回复）' : 'AI 导购助手'"
        @click="chat.open()"
      >
        <!-- 星芒图标：AI 的通用符号。不用聊天气泡 —— 那个语义是「转人工客服」 -->
        <svg class="ai-fab-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M10.5 1 Q12.7 6.8 18.5 9 Q12.7 11.2 10.5 17 Q8.3 11.2 2.5 9 Q8.3 6.8 10.5 1 Z
               M19 15.5 Q20 18 22.5 19 Q20 20 19 22.5 Q18 20 15.5 19 Q18 18 19 15.5 Z"
          />
        </svg>
        <span v-if="chat.unreadCount > 0" class="ai-fab-dot" aria-hidden="true" />
      </button>
    </el-tooltip>
  </div>

  <el-drawer
    v-model="chat.drawerOpen"
    title="AI 导购助手"
    direction="rtl"
    :size="isMobile ? '100%' : '440px'"
    class="ai-drawer"
  >
    <template #header>
      <div class="ai-header">
        <span class="ai-header-title">AI 导购助手</span>
        <el-button text size="small" :disabled="!chat.hasMessages" @click="chat.clear()">
          清空对话
        </el-button>
      </div>
    </template>

    <div ref="scrollRef" class="ai-body">
      <!-- 空态：引导语 + 示例问法 -->
      <div v-if="!chat.hasMessages" class="ai-welcome">
        <div class="ai-welcome-badge">AI</div>
        <p class="ai-welcome-title">你好，我是导购助手</p>
        <p class="ai-welcome-desc">
          用一句话说出你的需求，我会帮你筛出合适的二手好物。
        </p>
        <div class="ai-welcome-examples">
          <el-tag
            v-for="example in ['九成新2000以内的游戏本', '1000 以内的无线鼠标', '换个手机数码看看']"
            :key="example"
            type="info"
            effect="plain"
            class="ai-example-tag"
            @click="onSuggestion(example)"
          >
            {{ example }}
          </el-tag>
        </div>
      </div>

      <div v-for="message in chat.messages" :key="message.id" class="ai-turn">
        <!-- 用户消息靠右 -->
        <div v-if="message.role === 'user'" class="ai-row ai-row-user">
          <div class="ai-bubble ai-bubble-user">{{ message.content }}</div>
        </div>

        <!-- AI 消息靠左 -->
        <div v-else class="ai-row">
          <div class="ai-avatar">AI</div>
          <div class="ai-content">
            <!-- 思考过程：默认折叠，点开看后端真实步骤 -->
            <el-collapse v-if="message.thoughts.length" class="ai-thoughts">
              <el-collapse-item name="thought">
                <template #title>
                  <span class="ai-thoughts-title">
                    <span v-if="message.status === 'streaming'" class="ai-dot" />
                    思考过程（{{ message.thoughts.length }} 步）
                  </span>
                </template>
                <div v-for="(step, index) in message.thoughts" :key="index" class="ai-thought-step">
                  {{ index + 1 }}. {{ step }}
                </div>
              </el-collapse-item>
            </el-collapse>

            <!-- 放宽条件提示：用醒目的提示条，不依赖模型自觉说明 -->
            <el-alert
              v-if="message.relaxedNote"
              :title="message.relaxedNote"
              type="warning"
              show-icon
              :closable="false"
              class="ai-alert"
            />

            <!-- 商品卡片：直接嵌在对话里 -->
            <div v-if="message.products.length" class="ai-products">
              <div
                v-for="product in message.products"
                :key="product.id"
                class="ai-product"
                @click="goProduct(product.id)"
              >
                <img
                  v-if="product.images && product.images.length"
                  :src="product.images[0]"
                  :alt="product.title"
                  class="ai-product-cover"
                />
                <div v-else class="ai-product-cover ai-product-cover-empty">无图</div>
                <div class="ai-product-info">
                  <div class="ai-product-title">{{ product.title }}</div>
                  <div class="ai-product-meta">
                    <span class="ai-product-price">¥{{ product.price }}</span>
                    <span class="ai-product-cat">{{ product.category.name }}</span>
                  </div>
                </div>
              </div>
              <div v-if="message.productsTotal > message.products.length" class="ai-products-more">
                共 {{ message.productsTotal }} 件，这里展示前 {{ message.products.length }} 件
              </div>
            </div>

            <!-- 回答正文：内容本身是流式累加的，天然就是打字机效果 -->
            <div
              v-if="message.content"
              class="ai-bubble ai-bubble-ai"
              :class="{ 'ai-bubble-error': message.status === 'error' }"
            >
              {{ message.content }}
              <span v-if="message.status === 'streaming'" class="ai-caret" />
            </div>
            <div v-else-if="message.status === 'streaming'" class="ai-bubble ai-bubble-ai">
              <span class="ai-caret" />
            </div>

            <div v-if="message.errorMessage && message.status !== 'done'" class="ai-error">
              {{ message.errorMessage }}
            </div>

            <!-- 降级说明 -->
            <div v-if="message.status === 'done' && message.errorMessage" class="ai-degraded">
              {{ message.errorMessage }}
            </div>

            <div v-if="message.status === 'done'" class="ai-footer">
              <span v-if="sourceText(message)" class="ai-source">{{ sourceText(message) }}</span>
              <span v-if="message.elapsedMs" class="ai-elapsed">
                {{ (message.elapsedMs / 1000).toFixed(1) }}s
              </span>
            </div>

            <!-- 建议词：点击即发送 -->
            <div v-if="message.suggestions.length && message.status === 'done'" class="ai-suggestions">
              <el-tag
                v-for="suggestion in message.suggestions"
                :key="suggestion"
                type="primary"
                effect="plain"
                class="ai-suggestion-tag"
                @click="onSuggestion(suggestion)"
              >
                {{ suggestion }}
              </el-tag>
            </div>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="ai-input">
        <el-input
          v-model="input"
          type="textarea"
          :rows="2"
          resize="none"
          placeholder="说说你想要什么，Enter 发送 / Shift+Enter 换行"
          :disabled="chat.isStreaming"
          @keydown.enter.exact.prevent="onSend"
        />
        <!-- 流式期间变成红色「停止生成」，点击会 abort 并掐断上游计费 -->
        <el-button
          v-if="chat.isStreaming"
          type="danger"
          class="ai-send"
          @click="chat.stop()"
        >
          停止生成
        </el-button>
        <el-button v-else type="primary" class="ai-send" :disabled="!canSend" @click="onSend">
          发送
        </el-button>
      </div>
      <p class="ai-disclaimer">内容由 AI 生成，仅供参考，请以商品详情页信息为准。</p>
    </template>
  </el-drawer>
</template>

<style scoped>
/* 外层锚点：只负责一次性入场动画 */
.ai-fab-anchor {
  position: fixed;
  right: var(--space-2);
  bottom: var(--space-2);
  z-index: 2000;
  /* 用 both 保证动画结束后停在终态；这里改的是外层，不影响内层 button 的 hover */
  animation: ai-fab-enter 250ms cubic-bezier(0.05, 0.7, 0.1, 1) both;
}

@keyframes ai-fab-enter {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.ai-fab {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--el-color-primary);
  color: var(--brand-on-primary);
  cursor: pointer;
  /* 基础阴影保持静态；hover 时用伪元素叠一层更深的，
     这样只需要过渡 opacity，不触发布局或重绘 */
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  transition: transform 200ms cubic-bezier(0.2, 0, 0, 1);
}

/* 加深的阴影单独一层，只切 opacity —— 纯合成层变化，稳定 60fps */
.ai-fab::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.16);
  opacity: 0;
  pointer-events: none;
  transition: opacity 200ms cubic-bezier(0.2, 0, 0, 1);
}

.ai-fab:hover {
  transform: translateY(-2px);
}

.ai-fab:hover::after {
  opacity: 1;
}

.ai-fab:active {
  transform: translateY(0);
}

/* 键盘可达：只对 focus-visible 显示焦点环，鼠标点击不会出现 */
.ai-fab:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 3px;
}

.ai-fab-icon {
  width: 26px;
  height: 26px;
  fill: currentColor;
}

/* 未读红点：右上角并略微向外偏移（圆的包围盒四角在圆形之外），
   加一圈描边保证压在圆面上也能辨认 */
.ai-fab-dot {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--el-color-danger);
  box-shadow: 0 0 0 2px var(--el-bg-color);
}

/* 尊重系统的「减弱动效」偏好（WCAG 2.3.3） */
@media (prefers-reduced-motion: reduce) {
  .ai-fab-anchor {
    animation: none;
  }

  .ai-fab,
  .ai-fab::after {
    transition: none;
  }

  /* 生成中的光标与思考指示属于「进行中」反馈，
     关闭闪烁后仍有静态标记，不影响判断是否还在生成 */
  .ai-caret,
  .ai-dot {
    animation: none;
  }
}

.ai-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.ai-header-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.ai-body {
  height: 100%;
  overflow-y: auto;
  padding: 0 16px 16px;
}

.ai-welcome {
  padding: 24px 0;
  text-align: center;
}

.ai-welcome-badge {
  display: inline-block;
  width: 44px;
  height: 44px;
  line-height: 44px;
  border-radius: 12px;
  background: var(--el-color-primary);
  color: var(--brand-on-primary);
  font-weight: 700;
}

.ai-welcome-title {
  margin: 16px 0 8px;
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.ai-welcome-desc {
  margin: 0 0 16px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.ai-welcome-examples {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.ai-example-tag {
  cursor: pointer;
}

.ai-turn {
  margin-top: 16px;
}

.ai-row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.ai-row-user {
  justify-content: flex-end;
}

.ai-avatar {
  flex: 0 0 28px;
  height: 28px;
  line-height: 28px;
  border-radius: 8px;
  background: var(--el-color-primary);
  color: var(--brand-on-primary);
  font-size: 12px;
  font-weight: 700;
  text-align: center;
}

.ai-content {
  flex: 1;
  min-width: 0;
}

.ai-bubble {
  padding: 8px 12px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.ai-bubble-user {
  max-width: 78%;
  background: var(--el-color-primary);
  color: var(--brand-on-primary);
}

.ai-bubble-ai {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
}

.ai-bubble-error {
  background: var(--el-color-danger-light-9);
  color: var(--el-color-danger);
}

.ai-caret {
  display: inline-block;
  width: 2px;
  height: 14px;
  margin-left: 2px;
  vertical-align: text-bottom;
  background: var(--el-color-primary);
  animation: ai-blink 1s steps(2, start) infinite;
}

@keyframes ai-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}

.ai-thoughts {
  margin-bottom: 8px;
  border-top: none;
}

.ai-thoughts :deep(.el-collapse-item__header) {
  height: 32px;
  border-bottom: none;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.ai-thoughts :deep(.el-collapse-item__wrap) {
  border-bottom: none;
}

.ai-thoughts :deep(.el-collapse-item__content) {
  padding-bottom: 8px;
}

.ai-thoughts-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.ai-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--el-color-primary);
  animation: ai-blink 1s ease-in-out infinite;
}

.ai-thought-step {
  padding: 4px 8px;
  margin-bottom: 4px;
  border-left: 2px solid var(--el-color-primary-light-5);
  background: var(--el-fill-color-lighter);
  border-radius: 4px;
  font-size: 12px;
  color: var(--el-text-color-regular);
  line-height: 1.6;
}

.ai-alert {
  margin-bottom: 8px;
}

.ai-products {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 8px;
}

.ai-product {
  display: flex;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 12px;
  background: var(--el-bg-color);
  cursor: pointer;
  transition: box-shadow 0.2s;
}

.ai-product:hover {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
}

.ai-product-cover {
  flex: 0 0 56px;
  width: 56px;
  height: 56px;
  border-radius: 8px;
  object-fit: cover;
  background: var(--el-fill-color-light);
}

.ai-product-cover-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

.ai-product-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.ai-product-title {
  font-size: 13px;
  color: var(--el-text-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
}

.ai-product-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ai-product-price {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-color-primary);
}

.ai-product-cat {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

.ai-products-more {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  text-align: center;
}

.ai-error {
  margin-top: 6px;
  font-size: 12px;
  color: var(--el-color-danger);
}

.ai-degraded {
  margin-top: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.ai-footer {
  display: flex;
  gap: 8px;
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

.ai-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.ai-suggestion-tag {
  cursor: pointer;
}

.ai-input {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.ai-send {
  flex: 0 0 auto;
}

.ai-disclaimer {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  text-align: center;
}

/* ---------- 移动端 ---------- */
@media (max-width: 767px) {
  /* 抽屉已占满全宽，正文内边距保持 16px 即可，不必再额外留白 */
  .ai-body {
    padding: 0 var(--space-2) var(--space-2);
  }

  .ai-welcome {
    padding: var(--space-2) 0;
  }
}
</style>
