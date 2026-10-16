/** 全局类型定义 */

export type ApiFlavor = 'openai' | 'anthropic'

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

/** 一个可接入的 AI 平台配置 */
export interface ProviderProfile {
  id: string
  /** 展示名称，例如「DeepSeek 官方」 */
  name: string
  /** 预设标识，仅用于展示与去重 */
  presetId: string
  /** 接口协议：OpenAI 兼容 / Anthropic Messages */
  flavor: ApiFlavor
  /** 例如 https://api.deepseek.com/v1 */
  baseUrl: string
  /** 例如 /chat/completions，留空使用协议默认值 */
  path: string
  apiKey: string
  /** 当前使用的模型 */
  model: string
  /** 可选模型列表（可手动填写，也可从平台拉取） */
  models: string[]
  temperature: number
  maxTokens: number
  /** 额外请求头，JSON 文本，例如 {"X-Foo":"bar"} */
  extraHeaders: string
  /** 是否经由本地开发服务器代理转发（绕过 CORS） */
  useProxy: boolean
  /** Anthropic 协议版本号 */
  anthropicVersion?: string
  createdAt: number
  updatedAt: number
}

export type PreviewIsolation = 'shadow' | 'none'

/**
 * 工作模式：
 * - project：项目模式，保留每个组件的对话与历史版本
 * - scratch：临时模式，用完即走，只保留最新一版草稿
 */
export type WorkMode = 'project' | 'scratch'

/**
 * 生成偏好。
 * 「输出单个组件」与「脚本语言固定 TypeScript」是产品固定行为，不做成可配置项。
 */
export interface GenerationPrefs {
  /** 是否使用 <style scoped> */
  scopedStyle: boolean
  /** 是否额外要求适配深色背景 */
  themeAware: boolean
  /** 追加到系统提示词的额外要求 */
  extraSystemPrompt: string
}

/** 界面偏好 */
export interface UiPrefs {
  theme: 'dark' | 'light'
  isolation: PreviewIsolation
  autoReload: boolean
  reloadDelay: number
  captureConsole: boolean
  allowRemoteImports: boolean
  showReasoning: boolean
  /** 工作模式：项目模式 / 临时模式 */
  workMode: WorkMode
  /** 左栏宽度（组件信息 + 接口） */
  leftPanelWidth: number
  /** 右侧历史栏是否收起 */
  historyCollapsed: boolean
  /** 右侧历史栏宽度 */
  historyWidth: number
}

export interface SettingsState {
  profiles: ProviderProfile[]
  activeProfileId: string
  generation: GenerationPrefs
  ui: UiPrefs
}

/** 生成该版本时随需求一起发送的参考文件（只记元信息） */
export interface AttachmentRef {
  name: string
  size: number
}

/** 组件的一个版本：一次生成（新建或修改）产出的代码 */
export interface ComponentVersion {
  id: string
  /** 产生该版本的需求 / 修改说明 */
  prompt: string
  /** 提取后的 SFC 代码 */
  code: string
  /** 模型原始输出 */
  raw: string
  reasoning: string
  model: string
  providerName: string
  createdAt: number
  durationMs: number
  ok: boolean
  error?: string
  /** 该版本是否被手动编辑过 */
  edited?: boolean
  /** 生成该版本时用到的参考文件 */
  attachments?: AttachmentRef[]
}

/** 当前正在开发的组件：名称 + 版本历史 + 对话（项目模式下一个组件一份） */
export interface ComponentRecord {
  id: string
  name: string
  /** 首次需求 */
  prompt: string
  createdAt: number
  updatedAt: number
  versions: ComponentVersion[]
  /** 当前选中的版本 */
  activeVersionId: string
  /** 该组件的对话记录（项目模式下会一并作为上下文发给模型） */
  messages: ChatMessage[]
}

export type PreviewStatus = 'idle' | 'waiting' | 'compiling' | 'ready' | 'error'

export interface PreviewLogEntry {
  id: number
  level: 'log' | 'info' | 'warn' | 'error'
  text: string
  time: number
}

export type StreamStatus = 'idle' | 'streaming' | 'done' | 'stopped' | 'error'

/** 需求描述里附带的参考文件 */
export interface Attachment {
  id: string
  name: string
  /** 字节数 */
  size: number
  /** MIME 类型 */
  type: string
  /** 文本内容 */
  content: string
  /** 内容过长被截断 */
  truncated: boolean
}

/** 提示词里使用的附件视图（结构上是 Attachment 的子集） */
export interface PromptAttachment {
  name: string
  content: string
  truncated: boolean
}
