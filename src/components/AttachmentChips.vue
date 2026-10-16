<script setup lang="ts">
import AppIcon from '@/components/AppIcon.vue'
import { clearAttachments, removeAttachment, studio } from '@/stores/studio'

/** 对话框里的参考文件小标签（两个工作区共用） */
defineProps<{ formatSize: (bytes: number) => string }>()
</script>

<template>
  <div v-if="studio.attachments.length" class="attach-list">
    <span
      v-for="file in studio.attachments"
      :key="file.id"
      class="attach-chip"
      :title="`${file.name}（${formatSize(file.size)}）`"
    >
      <AppIcon name="file" :size="12" />
      <span class="attach-name truncate">{{ file.name }}</span>
      <span class="attach-size">{{ formatSize(file.size) }}</span>
      <span v-if="file.truncated" class="attach-warn" title="内容过长，已截断后发送">截断</span>
      <button class="attach-remove" type="button" title="移除" @click="removeAttachment(file.id)">
        <AppIcon name="close" :size="11" />
      </button>
    </span>
    <button class="btn btn-sm btn-ghost" type="button" @click="clearAttachments">全部移除</button>
  </div>
</template>

<style scoped>
.attach-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.attach-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 4px 6px 4px 9px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-2);
  font-size: 11.5px;
  color: var(--text-1);
}
.attach-name {
  max-width: 160px;
  color: var(--text-0);
}
.attach-size {
  color: var(--text-2);
  font-size: 10.5px;
}
.attach-warn {
  font-size: 10px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--warn-soft);
  color: var(--warn);
}
.attach-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 17px;
  height: 17px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-2);
  cursor: pointer;
  transition: all 0.16s;
}
.attach-remove:hover {
  background: var(--danger-soft);
  color: var(--danger);
}
</style>
