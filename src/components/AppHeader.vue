<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { activeProfile, isProfileReady, settingsState } from '@/stores/settings'
import { isStreaming, studio } from '@/stores/studio'
import { formatDuration } from '@/utils/misc'

defineEmits<{ (event: 'open-settings', tab?: 'platform' | 'generation'): void }>()

const provider = computed(() => activeProfile.value)
const ready = computed(() => isProfileReady.value)

function toggleTheme(): void {
  settingsState.ui.theme = settingsState.ui.theme === 'dark' ? 'light' : 'dark'
}
</script>

<template>
  <header class="app-header">
    <div class="brand">
      <span class="mark">
        <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
          <defs>
            <linearGradient id="acsLogo" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#42d392" />
              <stop offset="100%" stop-color="#647eff" />
            </linearGradient>
          </defs>
          <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#acsLogo)" opacity="0.16" />
          <rect x="1" y="1" width="30" height="30" rx="9" fill="none" stroke="url(#acsLogo)" stroke-width="1.6" />
          <path
            d="M16 7.5l7.2 4.2v8.6L16 24.5l-7.2-4.2v-8.6L16 7.5z"
            fill="none"
            stroke="url(#acsLogo)"
            stroke-width="1.8"
            stroke-linejoin="round"
          />
          <path d="M12.6 20.4L16 12l3.4 8.4" fill="none" stroke="url(#acsLogo)" stroke-width="1.8" stroke-linecap="round" />
        </svg>
      </span>
      <div class="brand-text">
        <strong>AI 组件工坊</strong>
        <small>生成即加载 · Vue 3 实时预览</small>
      </div>
    </div>

    <button class="provider-pill" type="button" @click="$emit('open-settings', 'platform')">
      <span class="dot" :class="ready ? 'ok' : 'warn'" :style="{ color: ready ? 'var(--accent)' : 'var(--warn)' }"></span>
      <span class="p-name">{{ provider?.name || '未配置平台' }}</span>
      <span class="sep">·</span>
      <span class="p-model mono">{{ provider?.model || '未选择模型' }}</span>
      <span v-if="!ready" class="need">需要配置</span>
    </button>

    <div class="spacer"></div>

    <div v-if="isStreaming" class="streaming">
      <span class="spinner"></span>
      <span>生成中 {{ formatDuration(studio.elapsedMs) }}</span>
      <span class="muted">{{ studio.receivedChars.toLocaleString() }} 字符</span>
    </div>
    <div v-else-if="studio.status === 'done' && studio.code && studio.elapsedMs > 0" class="streaming done">
      <AppIcon name="check" :size="14" />
      <span>上次生成耗时 {{ formatDuration(studio.elapsedMs) }}</span>
    </div>

    <button class="btn btn-icon" type="button" :title="settingsState.ui.theme === 'dark' ? '切换到浅色' : '切换到深色'" @click="toggleTheme">
      <AppIcon :name="settingsState.ui.theme === 'dark' ? 'sun' : 'moon'" :size="17" />
    </button>
    <button class="btn" type="button" @click="$emit('open-settings', 'platform')">
      <AppIcon name="gear" :size="15" />
      设置
    </button>
  </header>
</template>

<style scoped>
.app-header {
  height: var(--header-h);
  flex: none;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 16px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-1) 88%, transparent);
  backdrop-filter: blur(10px);
  z-index: 20;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.mark {
  display: inline-flex;
}
.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}
.brand-text strong {
  font-size: 15px;
  letter-spacing: 0.4px;
}
.brand-text small {
  font-size: 11px;
  color: var(--text-2);
}
.provider-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-2);
  cursor: pointer;
  font-size: 12.5px;
  color: var(--text-1);
  transition: border-color 0.18s, background 0.18s;
  max-width: 46vw;
}
.work-mode {
  display: none;
}
.provider-pill:hover {
  border-color: var(--border-strong);
  background: var(--bg-3);
}
.p-name {
  color: var(--text-0);
  font-weight: 600;
  white-space: nowrap;
}
.p-model {
  color: var(--text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 210px;
}
.sep {
  color: var(--text-2);
}
.need {
  margin-left: 2px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 600;
  background: var(--warn-soft);
  color: var(--warn);
}
.spacer {
  flex: 1;
}
.streaming {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--text-1);
  padding: 0 6px;
}
.streaming.done {
  color: var(--accent);
}
.streaming .muted {
  color: var(--text-2);
  font-size: 11.5px;
}
@media (max-width: 900px) {
  .brand-text small,
  .p-model,
  .sep {
    display: none;
  }
}
</style>
