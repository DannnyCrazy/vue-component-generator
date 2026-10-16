<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import ComponentInfo from '@/components/ComponentInfo.vue'
import ApiInspectorPanel from '@/components/ApiInspectorPanel.vue'
import ConfirmButton from '@/components/ConfirmButton.vue'
import VersionHistory from '@/components/VersionHistory.vue'
import DocPanel from '@/components/DocPanel.vue'
import PreviewPanel from '@/components/PreviewPanel.vue'
import CodePanel from '@/components/CodePanel.vue'
import RawOutputPanel from '@/components/RawOutputPanel.vue'
import ScratchComposer from '@/components/composers/ScratchComposer.vue'
import { bindWorkspaceShortcuts, useWorkspaceLayout } from '@/composables/useWorkspaceLayout'
import { currentComponent } from '@/stores/studio'

/**
 * #/scratch —— 临时模式工作区（用完即走）。
 * 只有一份草稿：左栏看它的输入/输出，没有组件列表、没有对话；
 * 版本历史只活在当前会话里，刷新后仅保留最新一版。
 */
const emit = defineEmits<{ (event: 'open-settings', tab?: 'platform' | 'generation'): void }>()

const { activeTab, resizing, switchTab, stageHint, clearApis, onResizeLeft, onResizeHistory, apiState, settingsState } =
  useWorkspaceLayout(['preview', 'code', 'raw', 'doc'], 'preview')

let unbind: (() => void) | null = null
onMounted(() => {
  unbind = bindWorkspaceShortcuts({
    onTab: switchTab,
    onSettings: () => emit('open-settings', 'platform'),
  })
})
onBeforeUnmount(() => unbind?.())
</script>

<template>
  <main class="workspace" data-testid="workspace-scratch" :class="{ resizing }">
    <!-- 左栏：上「组件信息（输入/输出）」 + 下「当前组件的接口」 -->
    <div class="col-left" :style="{ width: settingsState.ui.leftPanelWidth + 'px' }">
      <ComponentInfo />
      <section class="panel api-panel">
        <header class="panel-head">
          <span class="panel-title"><AppIcon name="link" :size="15" /> 接口</span>
          <span class="muted subject truncate">
            {{ currentComponent ? `当前组件 · ${currentComponent.name}` : '当前组件 · 未选择' }}
          </span>
          <div class="panel-actions">
            <span class="badge" :class="{ 'badge-ok': apiState.calls.length > 0 }">{{ apiState.calls.length }}</span>
            <ConfirmButton
              label="清空"
              confirm-text="确认清空"
              testid="api-clear"
              title="清空当前组件的接口记录"
              :disabled="!apiState.calls.length"
              @confirm="clearApis"
            />
          </div>
        </header>
        <ApiInspectorPanel />
      </section>
    </div>

    <div class="splitter" role="separator" aria-orientation="vertical" @pointerdown="onResizeLeft"></div>

    <!-- 中间：预览 / 代码 / 原始输出 / 接入文档 + 对话框（没有「对话」） -->
    <div class="col-right">
      <div class="stage">
        <div class="stage-bar">
          <div class="tabs">
            <button class="tab" :class="{ active: activeTab === 'preview' }" type="button" @click="switchTab('preview')">
              <AppIcon name="eye" :size="13" />
              实时预览
            </button>
            <button class="tab" :class="{ active: activeTab === 'code' }" type="button" @click="switchTab('code')">
              <AppIcon name="code" :size="13" />
              组件代码
            </button>
            <button class="tab" :class="{ active: activeTab === 'raw' }" type="button" @click="switchTab('raw')">
              <AppIcon name="terminal" :size="13" />
              原始输出
            </button>
            <button
              class="tab"
              :class="{ active: activeTab === 'doc' }"
              type="button"
              data-testid="tab-doc"
              @click="switchTab('doc')"
            >
              <AppIcon name="file" :size="13" />
              接入文档
            </button>
          </div>
          <div class="grow"></div>
          <span class="muted stage-hint">{{ stageHint }}</span>
        </div>

        <div class="stage-body">
          <PreviewPanel v-show="activeTab === 'preview'" :active="activeTab === 'preview'" />
          <CodePanel v-show="activeTab === 'code'" :active="activeTab === 'code'" />
          <RawOutputPanel v-show="activeTab === 'raw'" />
          <DocPanel v-show="activeTab === 'doc'" />
        </div>
      </div>

      <ScratchComposer @open-settings="(tab) => emit('open-settings', tab)" />
    </div>

    <!-- 最右侧：会话内的版本历史 -->
    <div
      v-show="!settingsState.ui.historyCollapsed"
      class="splitter splitter-right"
      role="separator"
      aria-orientation="vertical"
      @pointerdown="onResizeHistory"
    ></div>
    <VersionHistory :style="{ width: settingsState.ui.historyCollapsed ? '44px' : settingsState.ui.historyWidth + 'px' }" />
  </main>
</template>

<style scoped>
.workspace {
  flex: 1;
  min-height: 0;
  display: flex;
  padding: 12px;
  align-items: stretch;
}
.workspace.resizing {
  cursor: col-resize;
  user-select: none;
}
.col-left {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  min-width: 280px;
}
.subject {
  font-size: 11.5px;
  max-width: 170px;
}
.api-panel {
  flex: 1 1 55%;
  min-height: 200px;
}
.splitter {
  flex: none;
  width: 10px;
  cursor: col-resize;
  position: relative;
}
.splitter::after {
  content: '';
  position: absolute;
  top: 8px;
  bottom: 8px;
  left: 4px;
  width: 2px;
  border-radius: 2px;
  background: transparent;
  transition: background 0.18s;
}
.splitter:hover::after,
.workspace.resizing .splitter::after {
  background: var(--accent-line);
}
.col-right {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}
.stage {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.stage-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 32px;
}
.stage-hint {
  font-size: 11.5px;
}
.stage-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>
