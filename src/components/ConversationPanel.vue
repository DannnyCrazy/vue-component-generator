<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { activeComponent, conversation } from '@/stores/workspace'
import { formatTime } from '@/utils/misc'

/**
 * 项目模式的「对话」标签页：显示当前组件累积的多轮对话。
 * 这些内容会在「修改当前组件」时作为上下文一并发给模型。
 */

const expanded = ref<Record<number, boolean>>({})

interface Turn {
  index: number
  role: 'user' | 'assistant'
  /** 去掉代码块后的说明文字 */
  text: string
  codeLines: number
  time: number
}

/** 把带代码块的原始内容拆成「说明文字 + 代码行数」，避免对话里塞满整段代码 */
function summarize(content: string): { text: string; codeLines: number } {
  const parts = content.split(/```[a-zA-Z]*\n?/)
  let codeLines = 0
  const texts: string[] = []
  parts.forEach((part, index) => {
    if (index % 2 === 1) {
      codeLines += part.split('\n').length - 1
      return
    }
    const cleaned = part.replace(/```/g, '').trim()
    if (cleaned) texts.push(cleaned)
  })
  return { text: texts.join('\n\n'), codeLines: Math.max(0, codeLines) }
}

const turns = computed<Turn[]>(() =>
  conversation.value.map((message, index) => {
    const summary = summarize(message.content)
    return {
      index,
      role: message.role === 'assistant' ? 'assistant' : 'user',
      text: summary.text || (summary.codeLines ? '（仅包含代码）' : ''),
      codeLines: summary.codeLines,
      time: activeComponent.value?.versions[index]?.createdAt ?? Date.now(),
    }
  }),
)

function toggle(index: number): void {
  expanded.value[index] = !expanded.value[index]
}

function fullText(index: number): string {
  return conversation.value[index]?.content ?? ''
}
</script>

<template>
  <section class="panel chat-panel">
    <header class="panel-head">
      <span class="panel-title"><AppIcon name="terminal" :size="15" /> 对话</span>
      <span class="muted subject truncate">
        {{ activeComponent ? `当前组件 · ${activeComponent.name}` : '当前组件 · 未选择' }}
      </span>
      <div class="panel-actions">
        <span class="badge">{{ turns.length }}</span>
        <span class="muted hint">「修改当前组件」时会把这些内容作为上下文发给模型</span>
      </div>
    </header>

    <div class="chat-body scroll-y" data-testid="chat-list">
      <div v-if="!turns.length" class="empty-state">
        <span class="icon">💬</span>
        <h3>还没有对话</h3>
        <p>项目模式会保留每个组件的多轮对话；在下面描述需求或修改，这里就会记下来。</p>
      </div>

      <article v-for="turn in turns" :key="turn.index" class="turn" :class="turn.role" data-testid="chat-turn">
        <header class="turn-head">
          <span class="role">{{ turn.role === 'user' ? '你' : 'AI' }}</span>
          <span class="time">{{ formatTime(turn.time) }}</span>
          <span v-if="turn.codeLines" class="badge">含代码 {{ turn.codeLines }} 行</span>
          <button class="btn btn-sm btn-ghost" type="button" @click="toggle(turn.index)">
            {{ expanded[turn.index] ? '收起原文' : '查看原文' }}
          </button>
        </header>
        <pre v-if="expanded[turn.index]" class="bubble mono">{{ fullText(turn.index) }}</pre>
        <p v-else class="bubble">{{ turn.text }}</p>
      </article>
    </div>
  </section>
</template>

<style scoped>
.chat-panel {
  flex: 1;
  min-height: 0;
}
.subject {
  font-size: 11.5px;
  max-width: 220px;
}
.panel-actions .hint {
  font-size: 11px;
}
.chat-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.turn {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg-2);
}
.turn.user {
  border-color: var(--accent-2-soft);
  background: color-mix(in srgb, var(--accent-2) 8%, var(--bg-2));
}
.turn-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
}
.turn-head .btn {
  margin-left: auto;
}
.role {
  font-weight: 700;
  color: var(--text-0);
}
.turn.assistant .role {
  color: var(--accent);
}
.time {
  color: var(--text-2);
}
.bubble {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--text-1);
  white-space: pre-wrap;
  word-break: break-word;
}
.bubble.mono {
  font-family: var(--mono);
  font-size: 11.5px;
  max-height: 320px;
  overflow: auto;
  padding: 9px;
  border-radius: var(--radius-sm);
  background: var(--bg-0);
}
</style>
