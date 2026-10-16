<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { activeComponent, deleteVersion } from '@/stores/workspace'
import { settingsState } from '@/stores/settings'
import { isStreaming, openVersion, studio, syncFromLibrary } from '@/stores/studio'
import { toast } from '@/composables/useToast'
import { copyText, downloadText, formatDuration, formatTime } from '@/utils/misc'

/**
 * 挂在最右侧、可以收起的「当前组件历史」栏。
 * 收起后只留一条竖排窄条，点一下就展开。
 */
const collapsed = computed({
  get: () => settingsState.ui.historyCollapsed,
  set: (value: boolean) => {
    settingsState.ui.historyCollapsed = value
  },
})

const component = computed(() => activeComponent.value)
const versions = computed(() => component.value?.versions ?? [])
const activeIndex = computed(() =>
  versions.value.findIndex((version) => version.id === component.value?.activeVersionId),
)

function labelOf(index: number): string {
  return `v${index + 1}`
}

function onOpen(versionId: string): void {
  if (versionId === component.value?.activeVersionId) return
  openVersion(versionId)
}

function onDelete(versionId: string): void {
  if (!activeComponent.value) return
  deleteVersion(versionId)
  syncFromLibrary()
  toast('已删除该版本', 'info')
}

async function onCopy(): Promise<void> {
  if (!studio.code.trim()) return
  toast((await copyText(studio.code)) ? '当前版本代码已复制' : '复制失败，请手动选择', 'ok')
}

function onDownload(): void {
  if (!studio.code.trim()) return
  downloadText(`${component.value?.name || 'component'}.vue`, studio.code)
}

/** 回退到上一个版本 */
function onRevert(): void {
  if (activeIndex.value <= 0) {
    toast('已经是第一个版本了', 'info')
    return
  }
  const target = versions.value[activeIndex.value - 1]
  openVersion(target.id)
  toast(`已回退到 ${labelOf(activeIndex.value - 1)}`, 'ok')
}
</script>

<template>
  <aside class="history-rail panel" :class="{ collapsed }">
    <!-- 收起状态：一条竖排窄条 -->
    <button v-if="collapsed" class="rail-stub" type="button" title="展开历史记录" @click="collapsed = false">
      <AppIcon name="history" :size="15" />
      <span class="rail-label">历史记录</span>
      <span class="badge">{{ versions.length }}</span>
      <AppIcon name="expand" :size="13" />
    </button>

    <template v-else>
      <header class="panel-head">
        <span class="panel-title"><AppIcon name="history" :size="15" /> 历史记录</span>
        <span class="badge">{{ versions.length }}</span>
        <div class="panel-actions">
          <button
            class="btn btn-sm btn-ghost"
            type="button"
            title="回退到上一个版本"
            :disabled="isStreaming || activeIndex <= 0"
            @click="onRevert"
          >
            <AppIcon name="refresh" :size="12" />
          </button>
          <button class="btn btn-sm btn-ghost" type="button" title="复制当前版本代码" :disabled="!studio.code" @click="onCopy">
            <AppIcon name="copy" :size="12" />
          </button>
          <button class="btn btn-sm btn-ghost" type="button" title="下载当前版本 .vue" :disabled="!studio.code" @click="onDownload">
            <AppIcon name="download" :size="12" />
          </button>
          <button class="btn btn-sm btn-ghost" type="button" title="收起历史记录" @click="collapsed = true">
            <AppIcon name="shrink" :size="12" />
          </button>
        </div>
      </header>

      <div class="rail-body scroll-y" data-testid="version-strip">
        <p class="subject truncate" :title="component?.name">
          {{ component ? `当前组件 · ${component.name}` : '当前组件 · 未选择' }}
        </p>

        <p v-if="!versions.length" class="muted empty-tip">当前组件还没有历史版本。</p>

        <ul class="version-list">
          <li
            v-for="(version, index) in versions"
            :key="version.id"
            class="version-item"
            :class="{ active: version.id === component?.activeVersionId }"
            data-testid="version-chip"
            :title="version.prompt"
            @click="onOpen(version.id)"
          >
            <span class="v-head">
              <span class="v-label">{{ labelOf(index) }}</span>
              <span v-if="version.id === component?.activeVersionId" class="v-now">当前</span>
              <span v-if="version.edited" class="v-tag edited">已编辑</span>
              <span v-else-if="!version.ok" class="v-tag failed">未完成</span>
              <button
                v-if="versions.length > 1"
                class="v-remove"
                type="button"
                title="删除该版本"
                @click.stop="onDelete(version.id)"
              >
                <AppIcon name="close" :size="10" />
              </button>
            </span>
            <span class="v-prompt truncate">{{ version.prompt || '（无说明）' }}</span>
            <span class="v-meta">
              <span>{{ formatTime(version.createdAt) }}</span>
              <span class="truncate">{{ version.model || '未知模型' }}</span>
              <span>{{ formatDuration(version.durationMs) }}</span>
            </span>
          </li>
        </ul>
      </div>
    </template>
  </aside>
</template>

<style scoped>
.history-rail {
  flex: none;
  min-height: 0;
  overflow: hidden;
}
.history-rail.collapsed {
  width: 44px;
}

/* 栏比较窄，头部要紧凑：标题不换行、按钮缩小 */
.history-rail :deep(.panel-head) {
  gap: 6px;
  padding: 9px 8px 9px 12px;
}
.history-rail :deep(.panel-title) {
  flex: none;
  white-space: nowrap;
  font-size: 12.5px;
}
.history-rail :deep(.panel-actions) {
  gap: 1px;
}
.history-rail :deep(.panel-actions .btn) {
  width: 24px;
  height: 24px;
  padding: 0;
}
.history-rail :deep(.badge) {
  flex: none;
  height: 19px;
  padding: 0 7px;
  font-size: 10.5px;
}

/* ---------- 收起态 ---------- */
.rail-stub {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  padding: 12px 0;
  border: none;
  background: transparent;
  color: var(--text-1);
  cursor: pointer;
  transition: background 0.16s, color 0.16s;
}
.rail-stub:hover {
  background: var(--bg-hover);
  color: var(--accent);
}
.rail-label {
  writing-mode: vertical-rl;
  font-size: 12px;
  letter-spacing: 2px;
  color: var(--text-1);
}
.rail-stub:hover .rail-label {
  color: var(--accent);
}
.rail-stub .badge {
  background: var(--bg-3);
}

/* ---------- 展开态 ---------- */
.subject {
  font-size: 11.5px;
  color: var(--text-2);
  padding: 8px 10px 2px;
}
.rail-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  padding-bottom: 8px;
}
.empty-tip {
  font-size: 12px;
  padding: 14px 12px;
  text-align: center;
}
.version-list {
  list-style: none;
  margin: 0;
  padding: 6px 8px 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.version-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 0.16s, border-color 0.16s;
}
.version-item:hover {
  background: var(--bg-2);
  border-color: var(--border);
}
.version-item.active {
  background: var(--accent-soft);
  border-color: var(--accent-line);
}
.v-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.v-label {
  font-family: var(--mono);
  font-size: 11.5px;
  font-weight: 700;
  color: var(--text-0);
}
.version-item.active .v-label {
  color: var(--accent);
}
.v-now {
  font-size: 10px;
  padding: 0 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  color: var(--accent);
}
.v-tag {
  font-size: 10px;
  padding: 0 5px;
  border-radius: 999px;
}
.v-tag.edited {
  background: var(--warn-soft);
  color: var(--warn);
}
.v-tag.failed {
  background: var(--danger-soft);
  color: var(--danger);
}
.v-remove {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
  opacity: 0;
  transition: all 0.16s;
}
.version-item:hover .v-remove {
  opacity: 1;
}
.v-remove:hover {
  background: var(--danger-soft);
  color: var(--danger);
}
.v-prompt {
  font-size: 11.5px;
  color: var(--text-1);
  line-height: 1.5;
}
.v-meta {
  display: flex;
  gap: 8px;
  font-size: 10.5px;
  color: var(--text-2);
  white-space: nowrap;
}
.v-meta > .truncate {
  flex: 1;
  min-width: 0;
}

@media (max-width: 1080px) {
  .rail-stub {
    flex-direction: row;
    justify-content: center;
    gap: 8px;
    padding: 12px;
  }
  .rail-label {
    writing-mode: horizontal-tb;
    letter-spacing: 1px;
  }
}
</style>
