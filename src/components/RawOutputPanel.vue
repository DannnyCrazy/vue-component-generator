<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { settingsState } from '@/stores/settings'
import { studio } from '@/stores/studio'
import { toast } from '@/composables/useToast'
import { copyText } from '@/utils/misc'

const showReasoning = ref(false)

const hasReasoning = computed(() => studio.reasoning.trim().length > 0)
const rawText = computed(() => studio.raw || '')
const reasoningOpen = computed(() => showReasoning.value || settingsState.ui.showReasoning)

async function onCopy(): Promise<void> {
  if (!rawText.value) return
  toast((await copyText(rawText.value)) ? '已复制模型原始输出' : '复制失败', 'ok')
}
</script>

<template>
  <section class="panel raw-panel">
    <header class="panel-head">
      <span class="panel-title"><AppIcon name="terminal" :size="15" /> 模型原始输出</span>
      <span class="muted timing">{{ rawText.length.toLocaleString() }} 字符</span>
      <div class="panel-actions">
        <button
          v-if="hasReasoning"
          class="btn btn-sm btn-ghost"
          type="button"
          @click="showReasoning = !reasoningOpen"
        >
          <AppIcon name="bolt" :size="13" />
          {{ reasoningOpen ? '隐藏思考过程' : '查看思考过程' }}
        </button>
        <button class="btn btn-sm btn-ghost" type="button" :disabled="!rawText" title="复制原始输出" @click="onCopy">
          <AppIcon name="copy" :size="13" />
        </button>
      </div>
    </header>

    <div class="raw-body scroll-y">
      <div v-if="hasReasoning && reasoningOpen" class="reasoning">
        <div class="reasoning-head">
          <AppIcon name="bolt" :size="13" />
          <span>模型思考过程</span>
        </div>
        <pre class="mono">{{ studio.reasoning }}</pre>
      </div>

      <pre v-if="rawText" class="mono raw-text">{{ rawText }}</pre>
      <div v-else class="empty-state">
        <span class="icon">📡</span>
        <h3>暂无输出</h3>
        <p>生成过程中，模型返回的原始内容（包含代码块与说明文字）会实时显示在这里，方便排查问题。</p>
      </div>

      <div v-if="studio.errorDetail" class="notice err">
        <AppIcon name="alert" :size="14" />
        <div class="grow">
          <strong>错误详情</strong>
          <pre class="mono detail">{{ studio.errorDetail }}</pre>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.raw-panel {
  flex: 1;
  min-height: 0;
}
.timing {
  font-size: 11.5px;
}
.raw-body {
  flex: 1;
  overflow: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.raw-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  line-height: 1.7;
  color: var(--text-1);
}
.reasoning {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-2);
  padding: 10px;
}
.reasoning-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--accent-2);
  margin-bottom: 6px;
  font-weight: 600;
}
.reasoning pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 11.5px;
  color: var(--text-1);
  max-height: 260px;
  overflow: auto;
}
.detail {
  margin: 6px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 11.5px;
  max-height: 200px;
  overflow: auto;
}
</style>
