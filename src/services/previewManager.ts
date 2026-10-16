import { createApp, reactive } from 'vue'
import type { App } from 'vue'
import type { PreviewLogEntry, PreviewStatus } from '@/types'
import { compileComponent, normalizeCompileError } from '@/services/sfcLoader'
import { setCaptureScope, startCapture, stopCapture } from '@/stores/apiInspector'
import { textOf, truncate } from '@/utils/misc'

/**
 * 实时预览管理器：把生成出来的组件挂载到当前页面（真正的「在当前网站加载」）。
 *
 * - 挂载点在 PreviewPanel 提供的容器里；样式注入到同一个容器的作用域（ShadowRoot）中，
 *   生成的组件的样式不会污染宿主站点。
 * - 提供编译耗时、渲染耗时、运行期错误、console 日志的采集。
 */

export interface PreviewHostOptions {
  captureConsole: boolean
  allowRemoteImports: boolean
  /** 接口采集作用域（当前组件 id） */
  scopeId: string
}

export const previewState = reactive({
  status: 'idle' as PreviewStatus,
  /** 人类可读的状态说明 / 错误摘要 */
  message: '',
  /** 错误详情（堆栈、编译片段等） */
  detail: '',
  compileMs: 0,
  mountMs: 0,
  logs: [] as PreviewLogEntry[],
  /** 当前成功挂载的代码版本号 */
  revision: 0,
  mountedAt: 0,
  /** 当前挂载的代码长度，用于展示 */
  codeSize: 0,
})

const MAX_LOGS = 200

let currentApp: App | null = null
let hostEl: HTMLElement | null = null
let styleHost: HTMLElement | null = null
let logSeq = 0
let consoleOriginals: { log: typeof console.log; info: typeof console.info; warn: typeof console.warn; error: typeof console.error } | null = null
let globalHandlersInstalled = false

export function setPreviewHost(host: HTMLElement | null, styles: HTMLElement | null): void {
  hostEl = host
  styleHost = styles
}

export function appendLog(level: PreviewLogEntry['level'], text: string): void {
  const compact = truncate(text.replace(/\s+$/g, ''), 600)
  if (!compact) return
  previewState.logs.push({ id: ++logSeq, level, text: compact, time: Date.now() })
  if (previewState.logs.length > MAX_LOGS) {
    previewState.logs.splice(0, previewState.logs.length - MAX_LOGS)
  }
}

export function clearPreviewLogs(): void {
  previewState.logs.splice(0, previewState.logs.length)
}

/* ---------------- console 采集 ---------------- */

function installConsoleCapture(): void {
  if (consoleOriginals) return
  consoleOriginals = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  }
  const originals = consoleOriginals
  console.log = (...args: unknown[]) => {
    originals.log(...args)
    appendLog('log', args.map((a) => textOf(a)).join(' '))
  }
  console.info = (...args: unknown[]) => {
    originals.info(...args)
    appendLog('info', args.map((a) => textOf(a)).join(' '))
  }
  console.warn = (...args: unknown[]) => {
    originals.warn(...args)
    appendLog('warn', args.map((a) => textOf(a)).join(' '))
  }
  console.error = (...args: unknown[]) => {
    originals.error(...args)
    appendLog('error', args.map((a) => textOf(a)).join(' '))
  }
}

function uninstallConsoleCapture(): void {
  if (!consoleOriginals) return
  console.log = consoleOriginals.log
  console.info = consoleOriginals.info
  console.warn = consoleOriginals.warn
  console.error = consoleOriginals.error
  consoleOriginals = null
}

/* ---------------- 运行期全局错误 ---------------- */

function onWindowError(event: ErrorEvent): void {
  const message = event.message || textOf(event.error)
  previewState.status = 'error'
  previewState.message = message
  previewState.detail = event.error instanceof Error ? (event.error.stack ?? '') : ''
  appendLog('error', `运行期错误：${message}`)
}

function onUnhandledRejection(event: PromiseRejectionEvent): void {
  const reason = textOf(event.reason)
  appendLog('error', `未处理的 Promise 拒绝：${reason}`)
  if (previewState.status === 'ready') {
    previewState.status = 'error'
    previewState.message = reason
  }
}

function installGlobalHandlers(): void {
  if (globalHandlersInstalled) return
  window.addEventListener('error', onWindowError)
  window.addEventListener('unhandledrejection', onUnhandledRejection)
  globalHandlersInstalled = true
}

function uninstallGlobalHandlers(): void {
  if (!globalHandlersInstalled) return
  window.removeEventListener('error', onWindowError)
  window.removeEventListener('unhandledrejection', onUnhandledRejection)
  globalHandlersInstalled = false
}

/* ---------------- 挂载 / 卸载 ---------------- */

function clearInjectedStyles(): void {
  const root: ParentNode = styleHost ?? document.head
  root.querySelectorAll('style[data-acs-style]').forEach((node) => node.remove())
}

function teardown(): void {
  stopCapture()
  if (currentApp) {
    try {
      currentApp.unmount()
    } catch (error) {
      appendLog('warn', `卸载上一个组件时出错：${textOf(error)}`)
    }
    currentApp = null
  }
  if (hostEl) hostEl.innerHTML = ''
  clearInjectedStyles()
  uninstallConsoleCapture()
  uninstallGlobalHandlers()
  previewState.mountedAt = 0
  previewState.codeSize = 0
}

/** 清空预览区（例如用户清空代码时） */
export function clearPreview(): void {
  teardown()
  previewState.status = 'idle'
  previewState.message = ''
  previewState.detail = ''
  previewState.compileMs = 0
  previewState.mountMs = 0
}

/** 编译并挂载代码；返回是否成功 */
export async function renderPreview(code: string, options: PreviewHostOptions): Promise<boolean> {
  if (!hostEl) {
    previewState.status = 'error'
    previewState.message = '预览容器尚未就绪'
    return false
  }

  const source = (code || '').trim()
  if (!source) {
    clearPreview()
    return false
  }

  teardown()
  previewState.message = ''
  previewState.detail = ''
  previewState.status = 'compiling'

  const compileStart = performance.now()
  let component
  try {
    component = await compileComponent(source, {
      styleHost: styleHost ?? document.head,
      allowRemoteImports: options.allowRemoteImports,
      onLog: (level, message) => {
        if (level !== 'info') appendLog(level, message)
      },
    })
  } catch (error) {
    const normalized = normalizeCompileError(error)
    previewState.compileMs = performance.now() - compileStart
    previewState.status = 'error'
    previewState.message = normalized.message
    previewState.detail = normalized.stack ?? ''
    return false
  }
  previewState.compileMs = performance.now() - compileStart

  const mountStart = performance.now()
  let runtimeError = false
  try {
    if (options.captureConsole) installConsoleCapture()
    installGlobalHandlers()
    // 切换到当前组件的采集作用域，然后开始采集组件自身发起的请求
    setCaptureScope(options.scopeId)
    startCapture()

    const app = createApp(component)
    app.config.errorHandler = (err, _instance, info) => {
      runtimeError = true
      previewState.status = 'error'
      previewState.message = textOf(err)
      previewState.detail = `触发位置：${info}`
      appendLog('error', textOf(err))
    }
    app.config.warnHandler = (msg) => {
      appendLog('warn', msg)
    }
    app.mount(hostEl)
    currentApp = app
  } catch (error) {
    previewState.mountMs = performance.now() - mountStart
    previewState.status = 'error'
    previewState.message = textOf(error)
    previewState.detail = error instanceof Error ? (error.stack ?? '') : ''
    return false
  }

  previewState.mountMs = performance.now() - mountStart
  previewState.codeSize = source.length
  previewState.status = runtimeError ? 'error' : 'ready'
  previewState.revision += 1
  previewState.mountedAt = Date.now()
  return !runtimeError
}
