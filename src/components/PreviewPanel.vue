<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { settingsState } from '@/stores/settings'
import { loadDemoComponent, loadMeterDemo, studio, currentComponent } from '@/stores/studio'
import {
  clearPreview,
  clearPreviewLogs,
  previewState,
  renderPreview,
  setPreviewHost,
} from '@/services/previewManager'
import { toast } from '@/composables/useToast'

const props = defineProps<{ active: boolean }>()

const panelEl = ref<HTMLElement | null>(null)
const surfaceEl = ref<HTMLElement | null>(null)
const logsOpen = ref(false)
const showDetail = ref(false)
const isFullscreen = ref(false)

const isolation = computed(() => settingsState.ui.isolation)

/** ShadowRoot 内的基础样式：只影响预览区内部，不会污染宿主站点 */
const BASE_CSS = `
:host { display: block; height: 100%; }
*, *::before, *::after { box-sizing: border-box; }
.acs-mount { padding: 18px; min-height: 100%; color: inherit; font-family: inherit; }
`

let reloadTimer: number | null = null
let lastRenderedCode = ''

const statusText = computed(() => {
  switch (previewState.status) {
    case 'compiling':
      return '编译中…'
    case 'waiting':
      return '接收代码中…'
    case 'ready':
      return '已实时加载'
    case 'error':
      return '加载出错'
    default:
      return '待生成'
  }
})

const statusClass = computed(() => {
  switch (previewState.status) {
    case 'ready':
      return 'badge-ok'
    case 'error':
      return 'badge-err'
    case 'waiting':
    case 'compiling':
      return 'badge-info'
    default:
      return ''
  }
})

const errorCount = computed(() => previewState.logs.filter((log) => log.level === 'error').length)

const showEmpty = computed(() => !studio.code.trim() && previewState.status !== 'error')

/** 建立挂载点：Shadow DOM 隔离 或 直接挂载到宿主容器 */
function setupSurface(): void {
  const surface = surfaceEl.value
  if (!surface) return

  if (isolation.value === 'shadow') {
    const shadow = surface.attachShadow({ mode: 'open' })
    const base = document.createElement('style')
    base.setAttribute('data-acs-base', '1')
    base.textContent = BASE_CSS
    shadow.appendChild(base)

    const styles = document.createElement('div')
    styles.setAttribute('data-acs-styles', '1')
    shadow.appendChild(styles)

    const mount = document.createElement('div')
    mount.className = 'acs-mount'
    mount.setAttribute('data-acs-mount', '1')
    shadow.appendChild(mount)

    setPreviewHost(mount, styles)
  } else {
    const mount = document.createElement('div')
    mount.className = 'acs-mount'
    mount.setAttribute('data-acs-mount', '1')
    surface.appendChild(mount)
    setPreviewHost(mount, document.head)
  }
}

async function runRender(announce = false): Promise<void> {
  const code = studio.code.trim()
  if (!code) {
    clearPreview()
    return
  }
  const ok = await renderPreview(code, {
    captureConsole: settingsState.ui.captureConsole,
    allowRemoteImports: settingsState.ui.allowRemoteImports,
    scopeId: currentComponent.value?.id ?? 'draft',
  })
  if (ok) {
    lastRenderedCode = code
    if (announce) toast('预览已重新加载', 'ok')
  } else if (announce) {
    toast('加载失败，请查看预览区提示', 'err')
  }
}

function scheduleRender(delay?: number): void {
  if (reloadTimer) window.clearTimeout(reloadTimer)
  const wait = delay ?? settingsState.ui.reloadDelay
  reloadTimer = window.setTimeout(() => {
    reloadTimer = null
    void runRender()
  }, wait)
}

function onReload(): void {
  if (!studio.code.trim()) {
    toast('还没有可加载的代码，先生成一个组件吧', 'info')
    return
  }
  void runRender(true)
}

function onDemo(): void {
  loadDemoComponent()
  toast('已载入内置示例组件', 'ok')
}

function onMeterDemo(): void {
  loadMeterDemo()
  toast('已载入「电表监控」大屏案例', 'ok')
}

async function toggleFullscreen(): Promise<void> {
  const el = panelEl.value
  if (!el) return
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await el.requestFullscreen()
  } catch {
    isFullscreen.value = !isFullscreen.value
  }
}

function onFullscreenChange(): void {
  isFullscreen.value = Boolean(document.fullscreenElement)
  void nextTick(() => scheduleRender(0))
}

/* ---------------- 响应式重载 ---------------- */

watch(
  () => studio.code,
  () => {
    if (!studio.code.trim()) {
      clearPreview()
      lastRenderedCode = ''
      return
    }
    if (studio.code === lastRenderedCode) return
    if (!settingsState.ui.autoReload) {
      previewState.status = 'waiting'
      previewState.message = '代码已更新，点击「重新加载」手动预览'
      return
    }
    if (studio.status === 'streaming' && !studio.codeComplete) {
      previewState.status = 'waiting'
      previewState.message = '正在接收代码…'
      return
    }
    scheduleRender()
  },
)

watch(
  () => [settingsState.ui.isolation, settingsState.ui.captureConsole, settingsState.ui.allowRemoteImports],
  async () => {
    await nextTick()
    setupSurface()
    scheduleRender(60)
  },
)

watch(
  () => settingsState.ui.autoReload,
  (enabled) => {
    if (enabled && studio.code.trim()) scheduleRender(60)
  },
)

watch(
  () => props.active,
  (active) => {
    if (active && studio.code.trim() && studio.code !== lastRenderedCode) scheduleRender(30)
  },
)

onMounted(async () => {
  setupSurface()
  document.addEventListener('fullscreenchange', onFullscreenChange)
  await nextTick()
  if (studio.code.trim()) scheduleRender(80)
})

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  if (reloadTimer) window.clearTimeout(reloadTimer)
  clearPreview()
  setPreviewHost(null, null)
})
</script>

<template>
  <section ref="panelEl" class="panel preview-panel">
    <header class="panel-head">
      <span class="panel-title"><AppIcon name="eye" :size="15" /> 实时预览</span>
      <span class="badge" :class="statusClass">
        <span class="dot" :class="{ pulse: previewState.status === 'compiling' || previewState.status === 'waiting' }"></span>
        {{ statusText }}
      </span>
      <span v-if="previewState.status === 'ready'" class="muted timing">
        编译 {{ Math.round(previewState.compileMs) }}ms · 挂载 {{ Math.round(previewState.mountMs) }}ms ·
        {{ previewState.codeSize.toLocaleString() }} 字符
      </span>

      <div class="panel-actions">
        <span class="muted iso-tag">{{ isolation === 'shadow' ? '样式隔离' : '全局样式' }}</span>
        <button class="btn btn-sm btn-ghost" type="button" title="载入内置案例：电表监控数据孪生大屏" @click="onMeterDemo">
          <AppIcon name="bolt" :size="13" />
          电表监控案例
        </button>
        <button class="btn btn-sm btn-ghost" type="button" title="重新加载预览" @click="onReload">
          <AppIcon name="refresh" :size="13" />
          重新加载
        </button>
        <button class="btn btn-sm btn-ghost" type="button" title="全屏预览" @click="toggleFullscreen">
          <AppIcon :name="isFullscreen ? 'shrink' : 'expand'" :size="13" />
        </button>
        <button class="btn btn-sm btn-ghost" type="button" :title="'预览控制台（' + previewState.logs.length + ' 条）'" @click="logsOpen = !logsOpen">
          <AppIcon name="terminal" :size="13" />
          <span v-if="previewState.logs.length" :class="{ 'log-count-err': errorCount }">{{ previewState.logs.length }}</span>
        </button>
      </div>
    </header>

    <div class="preview-area">
      <!-- 挂载点：key 随隔离方式变化而重建，保证 attachShadow 只调用一次 -->
      <div :key="isolation" ref="surfaceEl" class="preview-surface" data-testid="preview-surface"></div>

      <div v-if="showEmpty" class="empty-state overlay">
        <span class="icon">🧩</span>
        <h3>还没有可预览的组件</h3>
        <p>在右下角的对话框里描述需求，点击「生成并加载」，生成的组件会直接挂载到这块区域里运行。</p>
        <div class="demo-actions">
          <button class="btn" type="button" @click="onMeterDemo">
            <AppIcon name="bolt" :size="14" />
            载入「电表监控」大屏案例
          </button>
          <button class="btn btn-ghost" type="button" @click="onDemo">
            载入内置示例组件
          </button>
        </div>
      </div>

      <div v-else-if="previewState.status === 'error'" class="error-overlay">
        <div class="error-card">
          <div class="error-head">
            <AppIcon name="alert" :size="16" />
            <strong>组件未能加载</strong>
            <button class="btn btn-sm btn-ghost" type="button" @click="showDetail = !showDetail">
              {{ showDetail ? '收起' : '详情' }}
            </button>
          </div>
          <pre class="error-msg mono">{{ previewState.message }}</pre>
          <pre v-if="showDetail && previewState.detail" class="error-detail mono">{{ previewState.detail }}</pre>
          <div class="error-actions">
            <button class="btn btn-sm" type="button" @click="onReload">
              <AppIcon name="refresh" :size="13" />
              重试
            </button>
            <span class="muted">提示：模型给出的代码可能缺少闭合标签或使用了不支持的依赖。</span>
          </div>
        </div>
      </div>

      <div v-else-if="previewState.status === 'compiling' || previewState.status === 'waiting'" class="loading-overlay">
        <span class="spinner"></span>
        <span>{{ previewState.status === 'waiting' ? previewState.message || '正在接收代码…' : '正在编译组件…' }}</span>
      </div>
    </div>

    <div v-if="logsOpen" class="console-drawer">
      <div class="console-head">
        <span class="panel-title"><AppIcon name="terminal" :size="13" /> 预览控制台</span>
        <span class="muted">{{ previewState.logs.length }} 条 · 采集组件内的 console 输出与运行期错误</span>
        <div class="panel-actions">
          <button class="btn btn-sm btn-ghost" type="button" @click="clearPreviewLogs">清空</button>
          <button class="btn btn-sm btn-ghost" type="button" @click="logsOpen = false">
            <AppIcon name="close" :size="12" />
          </button>
        </div>
      </div>
      <div class="console-body mono scroll-y">
        <p v-if="!previewState.logs.length" class="muted console-empty">暂无输出。</p>
        <p v-for="log in previewState.logs" :key="log.id" class="console-line" :class="log.level">
          <span class="lvl">{{ log.level }}</span>
          <span>{{ log.text }}</span>
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.preview-panel {
  flex: 1;
  min-height: 0;
}
.preview-panel:fullscreen {
  background: var(--bg-1);
  border-radius: 0;
  height: 100vh;
}
.timing {
  font-size: 11.5px;
}
.iso-tag {
  font-size: 11.5px;
  padding-right: 2px;
}
.log-count-err {
  color: var(--danger);
  font-weight: 700;
}
.preview-area {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: auto;
  background:
    radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--text-2) 22%, transparent) 1px, transparent 0) 0 0 / 16px 16px,
    var(--bg-0);
}
.preview-surface {
  min-height: 100%;
}
.demo-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}
.overlay {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--bg-0) 92%, transparent);
  backdrop-filter: blur(2px);
}
.error-overlay,
.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: color-mix(in srgb, var(--bg-0) 88%, transparent);
  backdrop-filter: blur(3px);
}
.loading-overlay {
  gap: 10px;
  color: var(--text-1);
  font-size: 13px;
  align-items: flex-start;
  padding-top: 40px;
  background: transparent;
}
.error-card {
  width: min(680px, 100%);
  border-radius: var(--radius);
  border: 1px solid color-mix(in srgb, var(--danger) 40%, transparent);
  background: var(--bg-1);
  box-shadow: var(--shadow);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.error-head {
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--danger);
}
.error-head .btn {
  margin-left: auto;
}
.error-msg {
  margin: 0;
  font-size: 12px;
  color: var(--text-1);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow: auto;
  padding: 10px;
  border-radius: var(--radius-sm);
  background: var(--bg-0);
}
.error-detail {
  margin: 0;
  font-size: 11.5px;
  color: var(--text-2);
  white-space: pre-wrap;
  max-height: 220px;
  overflow: auto;
  padding: 10px;
  border-radius: var(--radius-sm);
  background: var(--bg-0);
}
.error-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11.5px;
}
.console-drawer {
  flex: none;
  border-top: 1px solid var(--border);
  background: var(--bg-1);
  display: flex;
  flex-direction: column;
  height: 210px;
}
.console-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  font-size: 12px;
  border-bottom: 1px solid var(--border);
}
.console-head .muted {
  font-size: 11.5px;
}
.console-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
  font-size: 11.5px;
  line-height: 1.7;
}
.console-line {
  display: flex;
  gap: 8px;
  margin: 0 0 2px;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-1);
}
.console-line.warn {
  color: var(--warn);
}
.console-line.error {
  color: var(--danger);
}
.console-line .lvl {
  flex: none;
  width: 38px;
  opacity: 0.7;
  text-transform: uppercase;
  font-size: 10px;
  padding-top: 2px;
}
.console-empty {
  font-size: 11.5px;
}
</style>
