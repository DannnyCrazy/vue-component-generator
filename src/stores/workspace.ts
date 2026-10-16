import { computed, reactive, watch } from 'vue'
import type { ChatMessage, ComponentRecord, ComponentVersion, WorkMode } from '@/types'
import { settingsState } from '@/stores/settings'
import { loadJson, saveJson, titleFromPrompt, uid } from '@/utils/misc'

/**
 * 工作区：两种模式共用一套「组件 = 版本历史 + 对话」的数据结构，只是存法不同。
 *
 * - **项目模式（project）**：保留多个组件，每个组件有自己的对话与历史版本，整体持久化。
 *   存储键 `acs.project.v1`
 * - **临时模式（scratch）**：只用一份草稿，用完即走；刷新后只恢复最新一版代码。
 *   存储键 `acs.scratch.v1`
 *
 * 其余旧键（acs.components.v1 / acs.component.v1 / acs.history.v1）会在首次启动时迁移到项目模式。
 */

const PROJECT_KEY = 'acs.project.v1'
const SCRATCH_KEY = 'acs.scratch.v1'
const LEGACY_LIBRARY_KEY = 'acs.components.v1'
const LEGACY_COMPONENT_KEY = 'acs.component.v1'
const LEGACY_HISTORY_KEY = 'acs.history.v1'

const MAX_COMPONENTS = 20
const MAX_VERSIONS = 20
const MAX_MESSAGES = 40
const MAX_RAW = 4000

interface ProjectState {
  components: ComponentRecord[]
  activeId: string
}

interface ScratchState {
  prompt: string
  code: string
  name?: string
  updatedAt?: number
}

interface LegacyLibrary {
  components?: ComponentRecord[]
  activeId?: string
}

interface LegacyRecord {
  title?: string
  prompt?: string
  code?: string
  raw?: string
  reasoning?: string
  model?: string
  providerName?: string
  createdAt?: number
  durationMs?: number
  ok?: boolean
  error?: string
}

export const workspace = reactive({
  components: [] as ComponentRecord[],
  activeId: '',
  /** 临时模式的草稿（内存里的完整版本历史只存活到刷新） */
  draft: null as ComponentRecord | null,
})

/* ---------------- 规范化 ---------------- */

function normalizeVersion(input: Partial<ComponentVersion>, fallbackPrompt: string): ComponentVersion {
  return {
    id: input.id || uid('ver'),
    prompt: input.prompt || fallbackPrompt,
    code: input.code ?? '',
    raw: input.raw ?? '',
    reasoning: input.reasoning ?? '',
    model: input.model ?? '',
    providerName: input.providerName ?? '',
    createdAt: input.createdAt ?? Date.now(),
    durationMs: input.durationMs ?? 0,
    ok: input.ok ?? true,
    error: input.error,
    edited: input.edited ?? false,
    attachments: Array.isArray(input.attachments) ? input.attachments : [],
  }
}

function normalizeMessages(input: unknown): ChatMessage[] {
  if (!Array.isArray(input)) return []
  return input
    .filter((item) => item && typeof item === 'object' && typeof (item as ChatMessage).content === 'string')
    .map<ChatMessage>((item) => ({
      role: (item as ChatMessage).role === 'assistant' ? 'assistant' : 'user',
      content: (item as ChatMessage).content,
    }))
    .slice(-MAX_MESSAGES)
}

function normalizeComponent(input: Partial<ComponentRecord>): ComponentRecord | null {
  const rawVersions = Array.isArray(input.versions) ? input.versions : []
  const versions = rawVersions
    .filter((version) => Boolean(version) && typeof version === 'object')
    .map((version) => normalizeVersion(version, input.prompt ?? '未命名需求'))
  if (!versions.length) return null
  const activeVersionId = versions.some((version) => version.id === input.activeVersionId)
    ? (input.activeVersionId as string)
    : versions[versions.length - 1].id
  return {
    id: input.id || uid('cmp'),
    name: input.name || titleFromPrompt(input.prompt ?? '未命名组件'),
    prompt: input.prompt ?? versions[0].prompt,
    createdAt: input.createdAt ?? versions[0].createdAt,
    updatedAt: input.updatedAt ?? versions[versions.length - 1].createdAt,
    versions,
    activeVersionId,
    messages: normalizeMessages(input.messages),
  }
}

function componentFromLegacyRecord(record: LegacyRecord): ComponentRecord | null {
  return normalizeComponent({
    name: record.title || titleFromPrompt(record.prompt ?? ''),
    prompt: record.prompt ?? '',
    createdAt: record.createdAt ?? Date.now(),
    updatedAt: record.createdAt ?? Date.now(),
    versions: [
      {
        id: uid('ver'),
        prompt: record.prompt ?? '',
        code: record.code ?? '',
        raw: record.raw ?? '',
        reasoning: record.reasoning ?? '',
        model: record.model ?? '',
        providerName: record.providerName ?? '',
        createdAt: record.createdAt ?? Date.now(),
        durationMs: record.durationMs ?? 0,
        ok: record.ok ?? true,
        error: record.error,
      },
    ],
  })
}

/** 把旧版本用过的存储迁移成项目模式的组件列表 */
function migrateLegacy(): ComponentRecord[] {
  const library = loadJson<LegacyLibrary | null>(LEGACY_LIBRARY_KEY, null)
  const list = Array.isArray(library?.components) ? library.components : []
  const migrated: ComponentRecord[] = []
  for (const item of list) {
    const component = item ? normalizeComponent(item) : null
    if (component) migrated.push(component)
  }
  if (migrated.length) {
    const activeIndex = migrated.findIndex((item) => item.id === library?.activeId)
    if (activeIndex > 0) {
      const [active] = migrated.splice(activeIndex, 1)
      migrated.unshift(active)
    }
    return migrated.slice(0, MAX_COMPONENTS)
  }

  const single = loadJson<Partial<ComponentRecord> | null>(LEGACY_COMPONENT_KEY, null)
  if (single && typeof single === 'object') {
    const component = normalizeComponent(single)
    if (component) return [component]
  }

  const legacy = loadJson<LegacyRecord[] | { records?: LegacyRecord[] } | null>(LEGACY_HISTORY_KEY, null)
  const records = Array.isArray(legacy) ? legacy : Array.isArray(legacy?.records) ? legacy.records : []
  for (const record of records) {
    if (!record || typeof record.code !== 'string' || !record.code.trim()) continue
    const component = componentFromLegacyRecord(record)
    if (component) return [component]
  }
  return []
}

/* ---------------- 初始化 ---------------- */

function hydrateProject(): ProjectState {
  const stored = loadJson<Partial<ProjectState> | null>(PROJECT_KEY, null)
  let components = (Array.isArray(stored?.components) ? stored.components : [])
    .map((item) => (item ? normalizeComponent(item) : null))
    .filter((item): item is ComponentRecord => item !== null)
  if (!components.length) components = migrateLegacy()
  const activeId = components.some((item) => item.id === stored?.activeId)
    ? (stored!.activeId as string)
    : (components[0]?.id ?? '')
  return { components, activeId }
}

function hydrateScratch(): ComponentRecord | null {
  const stored = loadJson<ScratchState | null>(SCRATCH_KEY, null)
  if (!stored?.code?.trim()) return null
  return normalizeComponent({
    name: stored.name || titleFromPrompt(stored.prompt ?? '临时组件'),
    prompt: stored.prompt ?? '',
    createdAt: stored.updatedAt ?? Date.now(),
    updatedAt: stored.updatedAt ?? Date.now(),
    versions: [
      {
        id: uid('ver'),
        prompt: stored.prompt ?? '',
        code: stored.code,
        raw: '',
        reasoning: '',
        model: '',
        providerName: '',
        createdAt: stored.updatedAt ?? Date.now(),
        durationMs: 0,
        ok: true,
      },
    ],
  })
}

const initialProject = hydrateProject()
workspace.components = initialProject.components
workspace.activeId = initialProject.activeId
workspace.draft = hydrateScratch()

/* ---------------- 持久化 ---------------- */

function persistProject(): void {
  const components = [...workspace.components]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_COMPONENTS)
    .map((component) => ({
      ...component,
      messages: component.messages.slice(-MAX_MESSAGES),
      versions: component.versions.slice(-MAX_VERSIONS).map((version) => ({
        ...version,
        raw: version.raw.length > MAX_RAW ? version.raw.slice(0, MAX_RAW) : version.raw,
      })),
    }))
  saveJson(PROJECT_KEY, { components, activeId: workspace.activeId })
}

function persistScratch(): void {
  const draft = workspace.draft
  if (!draft) {
    saveJson(SCRATCH_KEY, null)
    return
  }
  const version = draft.versions.find((item) => item.id === draft.activeVersionId) ?? draft.versions[draft.versions.length - 1]
  saveJson(SCRATCH_KEY, {
    name: draft.name,
    prompt: version?.prompt ?? draft.prompt,
    code: version?.code ?? '',
    updatedAt: draft.updatedAt,
  } satisfies ScratchState)
}

watch(() => [workspace.components, workspace.activeId], persistProject, { deep: true })
watch(() => workspace.draft, persistScratch, { deep: true })

/* ---------------- 读取 ---------------- */

export const workMode = computed<WorkMode>(() => settingsState.ui.workMode)

export const isProjectMode = computed(() => workMode.value === 'project')

export const activeComponent = computed<ComponentRecord | null>(() => {
  if (workMode.value === 'scratch') return workspace.draft
  return workspace.components.find((item) => item.id === workspace.activeId) ?? workspace.components[0] ?? null
})

export const activeVersion = computed<ComponentVersion | null>(() => {
  const component = activeComponent.value
  if (!component) return null
  return (
    component.versions.find((version) => version.id === component.activeVersionId) ??
    component.versions[component.versions.length - 1] ??
    null
  )
})

export const activeVersionIndex = computed(() => {
  const component = activeComponent.value
  const version = activeVersion.value
  if (!component || !version) return -1
  return component.versions.findIndex((item) => item.id === version.id)
})

export const conversation = computed<ChatMessage[]>(() => activeComponent.value?.messages ?? [])

export const conversationTurns = computed(() => Math.floor(conversation.value.length / 2))

/* ---------------- 写入 ---------------- */

/** 新组件落地：项目模式新增一个组件，临时模式替换草稿 */
export function replaceComponent(prompt: string, version: ComponentVersion): ComponentRecord {
  const now = Date.now()
  const component: ComponentRecord = {
    id: uid('cmp'),
    name: titleFromPrompt(prompt),
    prompt,
    createdAt: now,
    updatedAt: now,
    versions: [version],
    activeVersionId: version.id,
    messages: [],
  }

  if (workMode.value === 'scratch') {
    workspace.draft = component
    return component
  }

  workspace.components.unshift(component)
  workspace.activeId = component.id
  if (workspace.components.length > MAX_COMPONENTS * 2) {
    workspace.components.splice(MAX_COMPONENTS * 2)
  }
  return component
}

export function appendVersion(version: ComponentVersion): void {
  const component = activeComponent.value
  if (!component) return
  component.versions.push(version)
  component.activeVersionId = version.id
  component.updatedAt = Date.now()
}

export function selectComponent(id: string): void {
  if (workspace.components.some((item) => item.id === id)) workspace.activeId = id
}

export function selectVersion(versionId: string): void {
  const component = activeComponent.value
  if (!component) return
  if (!component.versions.some((version) => version.id === versionId)) return
  component.activeVersionId = versionId
}

export function updateActiveVersionCode(code: string): void {
  const component = activeComponent.value
  const version = activeVersion.value
  if (!component || !version) return
  version.code = code
  version.edited = true
  component.updatedAt = Date.now()
}

export function appendMessages(messages: ChatMessage[]): void {
  const component = activeComponent.value
  if (!component || !messages.length) return
  component.messages.push(...messages)
  if (component.messages.length > MAX_MESSAGES) {
    component.messages.splice(0, component.messages.length - MAX_MESSAGES)
  }
  component.updatedAt = Date.now()
}

export function deleteVersion(versionId: string): void {
  const component = activeComponent.value
  if (!component || component.versions.length <= 1) return
  const index = component.versions.findIndex((version) => version.id === versionId)
  if (index < 0) return
  component.versions.splice(index, 1)
  if (component.activeVersionId === versionId) {
    component.activeVersionId = component.versions[Math.max(0, index - 1)].id
  }
  component.updatedAt = Date.now()
}

export function renameComponent(id: string, name: string): void {
  const component = workspace.components.find((item) => item.id === id)
  if (!component) return
  const trimmed = name.trim()
  if (!trimmed) return
  component.name = trimmed
  component.updatedAt = Date.now()
}

export function deleteComponent(id: string): void {
  const index = workspace.components.findIndex((item) => item.id === id)
  if (index < 0) return
  workspace.components.splice(index, 1)
  if (workspace.activeId === id) {
    workspace.activeId = workspace.components[0]?.id ?? ''
  }
}

/** 清空临时模式的草稿（用完即走） */
export function clearDraft(): void {
  workspace.draft = null
}

/** 清空项目模式的全部组件 */
export function clearProject(): void {
  workspace.components.splice(0, workspace.components.length)
  workspace.activeId = ''
}
