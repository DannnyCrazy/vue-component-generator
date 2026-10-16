import { computed, reactive } from 'vue'
import type { Attachment, ChatMessage, ComponentVersion, StreamStatus } from '@/types'
import { AiError, streamChat } from '@/services/aiClient'
import { extractComponentCode } from '@/services/codeExtract'
import { buildModifyMessage, buildSystemPrompt, buildUserMessage } from '@/services/prompts'
import { clearPreview } from '@/services/previewManager'
import { activeProfile, settingsState } from '@/stores/settings'
import {
  activeComponent,
  activeVersion,
  activeVersionIndex,
  appendMessages,
  appendVersion,
  clearDraft,
  conversation,
  conversationTurns,
  isProjectMode,
  replaceComponent,
  selectComponent,
  selectVersion,
  updateActiveVersionCode,
  workMode,
  workspace,
} from '@/stores/workspace'
import { DEMO_COMPONENT } from '@/config/demoComponent'
import { METER_DASHBOARD_COMPONENT, METER_SOURCE_COMPONENT } from '@/config/demoMeter'
import { uid } from '@/utils/misc'

/** 对话框的两种意图 */
export type ComposerMode = 'modify' | 'create'

export type CodeSource = 'ai' | 'demo' | 'version' | 'manual' | 'empty'

/** 生成工作台的全部运行时状态（组件数据在 stores/workspace.ts） */
export const studio = reactive({
  /** 对话框内容 */
  input: '',
  /** 修改当前组件 / 新建组件 */
  mode: 'create' as ComposerMode,
  /** 随需求一起发送给模型的参考文件 */
  attachments: [] as Attachment[],
  /** 当前正在编辑 / 预览的代码 */
  code: '',
  /** 代码是否已完整闭合 */
  codeComplete: false,
  /** 代码来源 */
  source: 'empty' as CodeSource,
  /** 是否被手动编辑过 */
  dirty: false,
  /** 模型原始输出 */
  raw: '',
  /** 思考过程（DeepSeek R1 等） */
  reasoning: '',
  status: 'idle' as StreamStatus,
  error: '',
  errorHint: '',
  errorDetail: '',
  model: '',
  providerName: '',
  elapsedMs: 0,
  receivedChars: 0,
})

let controller: AbortController | null = null
let timer: ReturnType<typeof setInterval> | null = null
let startedAt = 0

export const isStreaming = computed(() => studio.status === 'streaming')
export const hasCode = computed(() => studio.code.trim().length > 0)
export const currentComponent = activeComponent
export const currentVersion = activeVersion
export const versionIndex = activeVersionIndex
export const versionCount = computed(() => activeComponent.value?.versions.length ?? 0)
export const canModify = computed(() => Boolean(activeComponent.value && activeVersion.value))
export { conversation, conversationTurns, isProjectMode, workMode, workspace }

/* ---------------- 计时 ---------------- */

function startTimer(): void {
  stopTimer()
  startedAt = Date.now()
  timer = setInterval(() => {
    if (studio.status !== 'streaming') return
    studio.elapsedMs = Date.now() - startedAt
  }, 200)
}

function stopTimer(): void {
  if (timer) clearInterval(timer)
  timer = null
}

function resetError(): void {
  studio.error = ''
  studio.errorHint = ''
  studio.errorDetail = ''
}

/* ---------------- 参考文件 ---------------- */

const MAX_FILES = 8
const MAX_FILE_CHARS = 40000
const MAX_TOTAL_CHARS = 120000

const TEXT_EXTENSIONS = [
  'txt', 'md', 'markdown', 'json', 'jsonc', 'vue', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'css', 'scss', 'less', 'html', 'htm', 'csv', 'xml', 'yaml', 'yml', 'sql', 'sh', 'py',
  'java', 'go', 'rs', 'rb', 'php', 'svg', 'toml', 'ini', 'conf', 'log',
]

function isTextLike(file: File): boolean {
  if (file.type.startsWith('text/')) return true
  if (/(json|xml|javascript|typescript|yaml|ecmascript|svg|x-sh)/.test(file.type)) return true
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return TEXT_EXTENSIONS.includes(ext)
}

export const attachmentChars = computed(() =>
  studio.attachments.reduce((total, file) => total + file.content.length, 0),
)

export async function addAttachments(files: File[]): Promise<{ added: number; skipped: string[] }> {
  const skipped: string[] = []
  let added = 0
  let total = attachmentChars.value

  for (const file of files) {
    if (!isTextLike(file)) {
      skipped.push(`${file.name}（仅支持文本类文件）`)
      continue
    }
    if (studio.attachments.length >= MAX_FILES) {
      skipped.push(`${file.name}（最多 ${MAX_FILES} 个文件）`)
      continue
    }
    if (total >= MAX_TOTAL_CHARS) {
      skipped.push(`${file.name}（参考资料总量已达上限）`)
      continue
    }
    let content = ''
    try {
      content = await file.text()
    } catch {
      skipped.push(`${file.name}（读取失败）`)
      continue
    }
    const truncated = content.length > MAX_FILE_CHARS || total + content.length > MAX_TOTAL_CHARS
    const budget = Math.min(MAX_FILE_CHARS, Math.max(0, MAX_TOTAL_CHARS - total))
    if (truncated) content = content.slice(0, budget)
    studio.attachments.push({
      id: uid('file'),
      name: file.name,
      size: file.size,
      type: file.type || 'text/plain',
      content,
      truncated,
    })
    total += content.length
    added += 1
  }

  return { added, skipped }
}

export function removeAttachment(id: string): void {
  const index = studio.attachments.findIndex((file) => file.id === id)
  if (index >= 0) studio.attachments.splice(index, 1)
}

export function clearAttachments(): void {
  studio.attachments.splice(0, studio.attachments.length)
}

/* ---------------- 视图切换 ---------------- */

/** 把当前组件的当前版本代码同步到工作台 */
export function syncFromLibrary(): void {
  const version = activeVersion.value
  studio.code = version?.code ?? ''
  studio.codeComplete = extractComponentCode(studio.code).complete
  studio.raw = version?.raw ?? ''
  studio.reasoning = version?.reasoning ?? ''
  studio.model = version?.model ?? ''
  studio.providerName = version?.providerName ?? ''
  studio.elapsedMs = version?.durationMs ?? 0
  studio.receivedChars = version?.raw.length ?? 0
  studio.source = version ? (version.edited ? 'manual' : 'version') : 'empty'
  studio.dirty = false
  studio.status = version ? 'done' : 'idle'
  resetError()
  if (!version) clearPreview()
}

export function openVersion(versionId: string): void {
  if (!activeComponent.value || isStreaming.value) return
  selectVersion(versionId)
  syncFromLibrary()
}

/** 项目模式：切换当前组件 */
export function openComponent(id: string): void {
  if (isStreaming.value) return
  selectComponent(id)
  syncFromLibrary()
  studio.mode = 'modify'
}

/**
 * 切换工作模式：项目模式 ↔ 临时模式。
 * 两套数据各自独立保存，切换只是换一个视图。
 */
export function switchWorkMode(mode: 'project' | 'scratch'): void {
  if (isStreaming.value || mode === workMode.value) return
  settingsState.ui.workMode = mode
  syncFromLibrary()
  studio.mode = activeComponent.value ? 'modify' : 'create'
  studio.input = ''
  resetError()
}

/**
 * 「新建」按钮：
 * - 项目模式：只切换意图，生成成功后才新增一个组件（现有组件不受影响）
 * - 临时模式：用完即走，立刻清空草稿重新开始
 */
export function beginNewComponent(): void {
  if (isStreaming.value) return
  if (workMode.value === 'scratch') {
    clearDraft()
    resetWorkbench()
    return
  }
  studio.mode = 'create'
  studio.input = ''
  resetError()
}

/* ---------------- 生成 ---------------- */

function currentCodeForModify(): string {
  return studio.code.trim()
}

export async function generate(): Promise<boolean> {
  if (studio.status === 'streaming') return false

  const provider = activeProfile.value
  const text = studio.input.trim()
  const modifyTarget = studio.mode === 'modify' ? activeComponent.value : null
  const isModify = Boolean(modifyTarget)

  if (!text) {
    studio.status = 'error'
    studio.error = isModify ? '请输入修改要求' : '请先描述你想要的组件'
    studio.errorHint = isModify
      ? '例如：把表格改成卡片列表，并加上空数据状态。'
      : '例如：生成一个带搜索和分页的数据表格组件。'
    return false
  }
  if (!provider) {
    studio.status = 'error'
    studio.error = '没有可用的 AI 平台配置'
    studio.errorHint = '打开右上角「设置 → AI 平台」添加一个平台。'
    return false
  }

  const noKeyNeeded = /localhost|127\.0\.0\.1/.test(provider.baseUrl)
  if (!provider.baseUrl.trim() || !provider.model.trim() || (!provider.apiKey.trim() && !noKeyNeeded)) {
    studio.status = 'error'
    studio.error = 'AI 平台配置不完整'
    studio.errorHint = '请检查 Base URL、模型名与 API Key（本地模型可留空 Key）。'
    return false
  }

  const prefs = settingsState.generation
  const userMessage: ChatMessage = {
    role: 'user',
    content: isModify ? buildModifyMessage(text, currentCodeForModify()) : buildUserMessage(text, studio.attachments),
  }
  // 项目模式：把该组件之前的对话一并带上；临时模式：每次都是单轮，不留上下文
  const history: ChatMessage[] = isProjectMode.value && isModify ? [...conversation.value] : []
  const requestMessages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt(prefs) },
    ...history,
    userMessage,
  ]

  resetError()
  studio.raw = ''
  studio.reasoning = ''
  studio.receivedChars = 0
  studio.status = 'streaming'
  studio.model = provider.model
  studio.providerName = provider.name
  studio.elapsedMs = 0
  // 刻意不清空 studio.code：重新生成期间保留上一版预览，等新代码完整后再整体替换
  let runCode = ''
  startTimer()

  controller = new AbortController()
  const signal = controller.signal

  try {
    const result = await streamChat(provider, requestMessages, {
      signal,
      onDelta: (delta) => {
        if (delta.content) {
          studio.raw += delta.content
          studio.receivedChars = studio.raw.length
          const extracted = extractComponentCode(studio.raw)
          if (extracted.found) {
            runCode = extracted.code
            studio.code = extracted.code
            studio.codeComplete = extracted.complete
          }
        }
        if (delta.reasoning) studio.reasoning += delta.reasoning
      },
    })

    if (result.content) {
      studio.raw = result.content
      const extracted = extractComponentCode(studio.raw)
      if (extracted.found) {
        runCode = extracted.code
        studio.code = extracted.code
        studio.codeComplete = extracted.complete
      }
    }
    if (result.reasoning) studio.reasoning = result.reasoning

    studio.elapsedMs = Date.now() - startedAt

    if (!runCode.trim()) {
      studio.status = 'error'
      studio.error = '模型没有返回可识别的 Vue 组件代码'
      studio.errorHint = '可以直接重试，或在设置里换一个模型（推荐 deepseek-chat / gpt-4o 等代码能力较强的模型）。'
      studio.errorDetail = studio.raw.slice(0, 1500)
      return false
    }

    const version: ComponentVersion = {
      id: uid('ver'),
      prompt: text,
      code: runCode,
      raw: studio.raw,
      reasoning: studio.reasoning,
      model: provider.model,
      providerName: provider.name,
      createdAt: Date.now(),
      durationMs: studio.elapsedMs,
      ok: true,
      // 记下本次用到的参考文件，供左栏「输入信息」展示
      attachments: studio.attachments.map((file) => ({ name: file.name, size: file.size })),
    }

    if (isModify) {
      appendVersion(version)
    } else {
      // 新建：项目模式新增一个组件；临时模式替换草稿
      replaceComponent(text, version)
    }

    // 项目模式保留对话；临时模式用完即走，不留上下文
    if (isProjectMode.value) {
      appendMessages([userMessage, { role: 'assistant', content: result.content || studio.raw }])
    }

    studio.code = runCode
    studio.codeComplete = true
    studio.dirty = false
    studio.source = 'ai'
    studio.status = 'done'
    studio.mode = 'modify'
    studio.input = ''
    studio.attachments.splice(0, studio.attachments.length)
    return true
  } catch (error) {
    studio.elapsedMs = Date.now() - startedAt
    if (signal.aborted) {
      studio.status = 'stopped'
      studio.error = '已停止生成'
      studio.errorHint = '可以调整要求后重新发送。'
      return false
    }
    const aiError = error instanceof AiError ? error : null
    studio.status = 'error'
    studio.error = aiError?.message ?? (error instanceof Error ? error.message : String(error))
    studio.errorHint = aiError?.hint ?? ''
    studio.errorDetail = aiError?.detail ?? (error instanceof Error ? (error.stack ?? '') : '')
    return false
  } finally {
    stopTimer()
    controller = null
  }
}

export function stopGeneration(): void {
  controller?.abort()
  controller = null
  stopTimer()
}

/** 代码面板手动编辑：写回当前版本 */
export function setCode(code: string, source: CodeSource = 'manual'): void {
  studio.code = code
  studio.codeComplete = extractComponentCode(code).complete
  studio.source = source
  studio.dirty = source === 'manual'
  if (source === 'manual') updateActiveVersionCode(code)
}

/**
 * 把一份内置案例代码放进工作台：
 * 同名组件已存在时追加一个新版本，否则新建组件；
 * 临时模式下直接替换草稿。
 */
function applyBuiltinComponent(name: string, code: string): void {
  const existing = workspace.components.find((item) => item.name === name)
  const version: ComponentVersion = {
    id: uid('ver'),
    prompt: `${name}（内置案例，未调用 AI）`,
    code,
    raw: '',
    reasoning: '',
    model: '内置案例',
    providerName: '本地',
    createdAt: Date.now(),
    durationMs: 0,
    ok: true,
  }

  if (isProjectMode.value && existing) {
    workspace.activeId = existing.id
    appendVersion(version)
  } else {
    replaceComponent(`${name}（内置案例）`, version)
  }
  syncFromLibrary()
  studio.mode = 'modify'
}

/** 载入内置示例组件：项目模式新增一个组件，临时模式替换草稿 */
export function loadDemoComponent(): void {
  applyBuiltinComponent('内置示例组件', DEMO_COMPONENT)
}

/**
 * 载入内置的「电表监控」数据孪生大屏案例：
 * 同时把配套的「数据源状态」小卡片也放进组件列表，
 * 两者合起来演示「后端推送 → 大屏实时刷新」的完整链路。
 */
export function loadMeterDemo(): void {
  applyBuiltinComponent('电表监控大屏', METER_DASHBOARD_COMPONENT)
  applyBuiltinComponent('电表数据源状态', METER_SOURCE_COMPONENT)
  // 让大屏成为当前选中的组件（第二张卡片放完后把焦点切回去）
  const dashboard = workspace.components.find((item) => item.name.startsWith('电表监控大屏'))
  if (dashboard) {
    selectComponent(dashboard.id)
    syncFromLibrary()
    studio.mode = 'modify'
  }
}

/** 只重置工作台视图状态（不动任何组件数据） */
export function resetWorkbench(): void {  studio.raw = ''
  studio.reasoning = ''
  studio.code = ''
  studio.codeComplete = false
  studio.source = 'empty'
  studio.dirty = false
  studio.status = 'idle'
  studio.input = ''
  studio.mode = 'create'
  resetError()
  clearAttachments()
  clearPreview()
}
