<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { basicSetup } from 'codemirror'
import { EditorView } from '@codemirror/view'
import { Compartment, EditorState } from '@codemirror/state'
import { vue } from '@codemirror/lang-vue'
import { oneDark } from '@codemirror/theme-one-dark'
import AppIcon from '@/components/AppIcon.vue'
import { settingsState } from '@/stores/settings'
import { setCode, studio } from '@/stores/studio'
import { toast } from '@/composables/useToast'
import { copyText, downloadText } from '@/utils/misc'

const props = defineProps<{ active: boolean }>()

const hostEl = ref<HTMLElement | null>(null)
const locked = ref(false)

const themeCompartment = new Compartment()
const editableCompartment = new Compartment()

let view: EditorView | null = null

const lineCount = computed(() => (studio.code ? studio.code.split('\n').length : 0))
const charCount = computed(() => studio.code.length)

function themeExtension() {
  return settingsState.ui.theme === 'dark' ? oneDark : []
}

function syncFromStore(): void {
  if (!view) return
  const current = view.state.doc.toString()
  if (current === studio.code) return
  view.dispatch({
    changes: { from: 0, to: current.length, insert: studio.code },
    scrollIntoView: false,
  })
}

onMounted(() => {
  if (!hostEl.value) return
  view = new EditorView({
    parent: hostEl.value,
    state: EditorState.create({
      doc: studio.code,
      extensions: [
        basicSetup,
        vue(),
        themeCompartment.of(themeExtension()),
        editableCompartment.of([EditorView.editable.of(true), EditorState.readOnly.of(false)]),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return
          const text = update.state.doc.toString()
          if (text !== studio.code) setCode(text, 'manual')
        }),
      ],
    }),
  })
})

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})

watch(() => studio.code, syncFromStore)

watch(
  () => settingsState.ui.theme,
  () => {
    view?.dispatch({ effects: themeCompartment.reconfigure(themeExtension()) })
  },
)

watch(locked, (value) => {
  view?.dispatch({
    effects: editableCompartment.reconfigure([
      EditorView.editable.of(!value),
      EditorState.readOnly.of(value),
    ]),
  })
})

watch(
  () => props.active,
  (active) => {
    if (active) window.setTimeout(() => view?.requestMeasure(), 30)
  },
)

async function onCopy(): Promise<void> {
  if (!studio.code.trim()) return
  toast((await copyText(studio.code)) ? '代码已复制到剪贴板' : '复制失败，请手动选择', 'ok')
}

function onDownload(): void {
  if (!studio.code.trim()) return
  downloadText('component.vue', studio.code)
}

function onFormat(): void {
  // 轻量「整理」：去掉行尾空格、压缩连续空行，避免引入额外依赖
  const cleaned = studio.code
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
  setCode(cleaned, 'manual')
  syncFromStore()
  toast('已清理行尾空格与多余空行', 'ok')
}
</script>

<template>
  <section class="panel code-panel">
    <header class="panel-head">
      <span class="panel-title"><AppIcon name="code" :size="15" /> 组件代码</span>
      <span class="muted timing">{{ lineCount }} 行 · {{ charCount.toLocaleString() }} 字符</span>
      <span v-if="studio.dirty" class="badge badge-warn">已手动编辑</span>
      <div class="panel-actions">
        <button class="btn btn-sm btn-ghost" type="button" :title="locked ? '解锁编辑' : '锁定编辑'" @click="locked = !locked">
          <AppIcon :name="locked ? 'close' : 'wand'" :size="13" />
          {{ locked ? '已锁定' : '可编辑' }}
        </button>
        <button class="btn btn-sm btn-ghost" type="button" title="清理格式" @click="onFormat">
          <AppIcon name="sparkles" :size="13" />
        </button>
        <button class="btn btn-sm btn-ghost" type="button" title="复制代码" @click="onCopy">
          <AppIcon name="copy" :size="13" />
        </button>
        <button class="btn btn-sm btn-ghost" type="button" title="下载 .vue 文件" @click="onDownload">
          <AppIcon name="download" :size="13" />
        </button>
      </div>
    </header>

    <div class="editor-wrap">
      <div ref="hostEl" class="editor-host" data-testid="code-editor"></div>
      <div v-if="!studio.code.trim()" class="editor-empty">
        <AppIcon name="file" :size="26" />
        <p>生成的组件代码会显示在这里，你可以直接编辑它，预览会实时跟随刷新。</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.code-panel {
  flex: 1;
  min-height: 0;
}
.timing {
  font-size: 11.5px;
}
.editor-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.editor-host {
  height: 100%;
  overflow: auto;
}
.editor-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  text-align: center;
  color: var(--text-2);
  background: var(--bg-1);
  padding: 30px;
  font-size: 12.5px;
  pointer-events: none;
}
.editor-empty p {
  max-width: 320px;
  line-height: 1.7;
}
</style>
