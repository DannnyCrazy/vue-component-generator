<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import AttachmentChips from '@/components/AttachmentChips.vue'
import { useAttachments } from '@/composables/useAttachments'
import { isProfileReady } from '@/stores/settings'
import {
  beginNewComponent,
  canModify,
  conversationTurns,
  currentComponent,
  generate,
  isStreaming,
  stopGeneration,
  studio,
  versionCount,
} from '@/stores/studio'
import { toast } from '@/composables/useToast'
import { formatDuration } from '@/utils/misc'

/** 项目模式的对话框：新建组件不会影响已有组件，修改会带上该组件的对话上下文 */
const emit = defineEmits<{ (event: 'open-settings', tab?: 'platform' | 'generation'): void }>()

const { dragging, onPick, onDrop, openPicker, setFileInput, formatSize } = useAttachments()

const inputEl = ref<HTMLTextAreaElement | null>(null)
const showDetail = ref(false)

const ready = computed(() => isProfileReady.value)
const isModify = computed(() => studio.mode === 'modify' && canModify.value)
const canSend = computed(() => studio.input.trim().length > 0 && !isStreaming.value)
const placeholder = computed(() =>
  isModify.value
    ? `描述要对「${currentComponent.value?.name ?? '当前组件'}」做的修改，例如：加上暗色模式切换按钮…`
    : '描述你想要的组件，例如：生成一个带搜索、排序和分页的用户数据表格，使用内置模拟数据…',
)

function autoGrow(): void {
  const el = inputEl.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 180)}px`
}

onMounted(autoGrow)
watch(() => studio.input, () => void nextTick(autoGrow))
watch(
  () => studio.mode,
  () => {
    void nextTick(autoGrow)
    inputEl.value?.focus()
  },
)

async function onSend(): Promise<void> {
  if (!canSend.value) return
  const ok = await generate()
  if (ok) toast(isModify.value ? '已生成新版本并加载' : '组件已生成并加入列表', 'ok')
  else if (studio.status === 'error') toast(studio.error, 'err', 4200)
  void nextTick(autoGrow)
}

function onStop(): void {
  stopGeneration()
  toast('已停止生成', 'info')
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey) return
  event.preventDefault()
  if (canSend.value) void onSend()
}
</script>

<template>
  <section
    class="panel composer"
    :class="{ dragging }"
    @dragover.prevent="dragging = true"
    @dragleave="dragging = false"
    @drop.prevent="onDrop"
  >
    <div v-if="!ready" class="notice warn composer-notice">
      <AppIcon name="alert" :size="14" />
      <span>
        还没有配置可用的 AI 平台。
        <button class="link" type="button" @click="emit('open-settings', 'platform')">立即配置</button>
        （默认 DeepSeek；也可以先用预览区的「示例组件」体验）
      </span>
    </div>

    <AttachmentChips :format-size="formatSize" />

    <textarea
      ref="inputEl"
      v-model="studio.input"
      class="textarea composer-input"
      data-testid="composer-input"
      rows="2"
      :placeholder="placeholder"
      @keydown="onKeydown"
    ></textarea>

    <div v-if="studio.status === 'streaming'" class="status-line">
      <span class="spinner"></span>
      <span>
        正在接收模型输出… {{ formatDuration(studio.elapsedMs) }}
        <template v-if="studio.code">
          · {{ studio.codeComplete ? '代码已完整，实时预览中' : '等待代码闭合后即时加载' }}
        </template>
      </span>
    </div>

    <div v-else-if="studio.error" class="notice" :class="studio.status === 'error' ? 'err' : 'info'">
      <AppIcon name="alert" :size="14" />
      <div class="grow">
        <strong>{{ studio.error }}</strong>
        <p v-if="studio.errorHint" class="hint">{{ studio.errorHint }}</p>
        <button v-if="studio.errorDetail" class="link" type="button" @click="showDetail = !showDetail">
          {{ showDetail ? '收起详情' : '查看详情' }}
        </button>
        <pre v-if="showDetail" class="detail mono">{{ studio.errorDetail }}</pre>
      </div>
    </div>

    <div class="composer-bar">
      <button class="btn btn-sm btn-ghost" type="button" title="添加参考文件" @click="openPicker">
        <AppIcon name="plus" :size="13" />
        附件
      </button>
      <input :ref="setFileInput" class="hidden-input" data-testid="composer-file" type="file" multiple @change="onPick" />

      <div class="mode-switch" role="group" aria-label="生成意图">
        <button
          class="mode-btn"
          :class="{ active: studio.mode === 'modify' }"
          type="button"
          :disabled="!canModify"
          data-testid="mode-modify"
          @click="studio.mode = 'modify'"
        >
          修改当前组件
        </button>
        <button
          class="mode-btn"
          :class="{ active: studio.mode === 'create' }"
          type="button"
          data-testid="mode-create"
          title="生成成功后新增一个组件，已有组件不受影响"
          @click="beginNewComponent()"
        >
          新建组件
        </button>
      </div>

      <span class="grow"></span>
      <span v-if="versionCount" class="muted meta">
        {{ versionCount }} 个版本 · {{ conversationTurns }} 轮对话
      </span>
      <span class="muted tip"><kbd>Enter</kbd> 发送 · <kbd>Shift</kbd>+<kbd>Enter</kbd> 换行</span>
      <button class="btn btn-icon" type="button" title="生成偏好" data-testid="composer-prefs" @click="emit('open-settings', 'generation')">
        <AppIcon name="gear" :size="15" />
      </button>
      <button v-if="!isStreaming" class="btn btn-primary" type="button" :disabled="!canSend" data-testid="send" @click="onSend">
        <AppIcon :name="isModify ? 'refresh' : 'sparkles'" :size="15" />
        {{ isModify ? '发送修改' : '生成并加载' }}
      </button>
      <button v-else class="btn btn-danger" type="button" @click="onStop">
        <AppIcon name="stop" :size="15" />
        停止
      </button>
    </div>

    <div v-if="dragging" class="drop-mask">
      <AppIcon name="download" :size="20" />
      <span>松开鼠标即可添加参考文件</span>
    </div>
  </section>
</template>

<style scoped>
.composer {
  position: relative;
  flex: none;
  padding: 10px 12px 11px;
  gap: 9px;
  display: flex;
  flex-direction: column;
}
.composer-notice {
  padding: 8px 10px;
  font-size: 12px;
}
.composer-input {
  min-height: 54px;
  max-height: 180px;
  font-size: 13.5px;
  line-height: 1.7;
  resize: none;
}
.hidden-input {
  display: none;
}
.composer-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.tip,
.meta {
  font-size: 11px;
  white-space: nowrap;
}
.status-line {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--text-1);
  padding: 7px 10px;
  border-radius: var(--radius-sm);
  background: var(--bg-2);
  border: 1px dashed var(--border-strong);
}
.notice {
  padding: 8px 10px;
  font-size: 12px;
}
.link {
  border: none;
  background: none;
  color: var(--accent);
  cursor: pointer;
  padding: 0;
  font-size: inherit;
  text-decoration: underline dotted;
}
.detail {
  margin: 8px 0 0;
  max-height: 160px;
  overflow: auto;
  padding: 9px;
  border-radius: var(--radius-sm);
  background: rgba(0, 0, 0, 0.28);
  font-size: 11.5px;
  white-space: pre-wrap;
  word-break: break-word;
}
.drop-mask {
  position: absolute;
  inset: 0;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: var(--radius);
  border: 2px dashed var(--accent);
  background: color-mix(in srgb, var(--bg-1) 88%, transparent);
  backdrop-filter: blur(2px);
  color: var(--accent);
  font-size: 12.5px;
  pointer-events: none;
}
</style>
