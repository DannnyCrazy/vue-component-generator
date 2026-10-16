<script setup lang="ts">
import { nextTick, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import type { ComponentRecord } from '@/types'
import { activeComponent, deleteComponent, renameComponent, workspace } from '@/stores/workspace'
import { beginNewComponent, isStreaming, openComponent } from '@/stores/studio'
import { toast } from '@/composables/useToast'
import { formatTime } from '@/utils/misc'

/** 项目模式左栏上半：组件列表（每个组件都有自己的对话与版本历史） */
const renamingId = ref('')
const renameText = ref('')
const pendingDeleteId = ref('')
const renameInput = ref<HTMLInputElement | null>(null)

function turnCount(component: ComponentRecord): number {
  return Math.floor(component.messages.length / 2)
}

async function startRename(component: ComponentRecord): Promise<void> {
  pendingDeleteId.value = ''
  renamingId.value = component.id
  renameText.value = component.name
  await nextTick()
  renameInput.value?.select()
}

function commitRename(): void {
  if (!renamingId.value) return
  const name = renameText.value.trim()
  if (name) renameComponent(renamingId.value, name)
  renamingId.value = ''
}

function onDelete(id: string): void {
  deleteComponent(id)
  pendingDeleteId.value = ''
  toast('已删除该组件', 'info')
}
</script>

<template>
  <section class="panel component-panel">
    <header class="panel-head">
      <span class="panel-title"><AppIcon name="layers" :size="15" /> 组件</span>
      <div class="panel-actions">
        <span class="badge">{{ workspace.components.length }}</span>
        <button class="btn btn-sm btn-ghost" type="button" title="新建组件" @click="beginNewComponent">
          <AppIcon name="plus" :size="13" />
          新建
        </button>
      </div>
    </header>

    <div class="component-list scroll-y" data-testid="component-list">
      <p v-if="!workspace.components.length" class="muted empty-tip">
        还没有组件。<br />在右下角的对话框里描述需求，生成第一个组件吧。
      </p>

      <article
        v-for="component in workspace.components"
        :key="component.id"
        class="component-item"
        :class="{ active: component.id === activeComponent?.id }"
        data-testid="component-item"
        @click="openComponent(component.id)"
      >
        <span class="mark"><AppIcon name="file" :size="13" /></span>

        <span class="info">
          <input
            v-if="renamingId === component.id"
            ref="renameInput"
            v-model="renameText"
            class="rename-input"
            type="text"
            @click.stop
            @keydown.enter.prevent="commitRename"
            @keydown.esc.prevent="renamingId = ''"
            @blur="commitRename"
          />
          <span v-else class="name truncate" :title="component.name">{{ component.name }}</span>
          <span class="meta">
            <span>{{ component.versions.length }} 版本</span>
            <span>·</span>
            <span>{{ turnCount(component) }} 轮对话</span>
            <span>·</span>
            <span>{{ formatTime(component.updatedAt) }}</span>
          </span>
        </span>

        <span v-if="pendingDeleteId === component.id" class="confirm" @click.stop>
          <button class="btn btn-sm btn-danger" type="button" @click="onDelete(component.id)">删除</button>
          <button class="btn btn-sm btn-ghost" type="button" @click="pendingDeleteId = ''">取消</button>
        </span>
        <span v-else class="actions" @click.stop>
          <button class="btn btn-sm btn-ghost" type="button" title="重命名" @click="startRename(component)">
            <AppIcon name="wand" :size="12" />
          </button>
          <button
            class="btn btn-sm btn-ghost"
            type="button"
            title="删除组件"
            :disabled="isStreaming"
            @click="pendingDeleteId = component.id"
          >
            <AppIcon name="trash" :size="12" />
          </button>
        </span>
      </article>
    </div>
  </section>
</template>

<style scoped>
.component-panel {
  flex: 1 1 45%;
  min-height: 168px;
}
.component-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.empty-tip {
  font-size: 12px;
  padding: 16px 12px;
  text-align: center;
  line-height: 1.8;
}
.component-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 9px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 0.16s, border-color 0.16s;
}
.component-item:hover {
  background: var(--bg-2);
  border-color: var(--border);
}
.component-item.active {
  background: var(--accent-soft);
  border-color: var(--accent-line);
}
.mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex: none;
  border-radius: 7px;
  background: var(--bg-3);
  color: var(--text-2);
}
.component-item.active .mark {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  color: var(--accent);
}
.info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.name {
  font-size: 12.5px;
  color: var(--text-0);
  font-weight: 500;
}
.component-item.active .name {
  color: var(--accent);
}
.meta {
  display: flex;
  gap: 4px;
  font-size: 10.5px;
  color: var(--text-2);
  white-space: nowrap;
  overflow: hidden;
}
.rename-input {
  width: 100%;
  padding: 3px 6px;
  border-radius: 6px;
  border: 1px solid var(--accent-line);
  background: var(--bg-1);
  color: var(--text-0);
  font-size: 12.5px;
  outline: none;
}
.actions {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.16s;
}
.component-item:hover .actions {
  opacity: 1;
}
.confirm {
  display: flex;
  gap: 4px;
}
</style>
