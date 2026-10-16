import type { ApiFlavor, ProviderProfile, SettingsState } from '@/types'
import { uid } from '@/utils/misc'

export interface ProviderPreset {
  id: string
  /** 平台展示名 */
  name: string
  flavor: ApiFlavor
  baseUrl: string
  path: string
  models: string[]
  /** API Key 申请地址 */
  keyUrl?: string
  note?: string
  useProxy?: boolean
}

/** 内置平台预设：默认 DeepSeek 官方，其余为常见 OpenAI 兼容平台 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek 官方',
    flavor: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    path: '/chat/completions',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    keyUrl: 'https://platform.deepseek.com/api_keys',
    note: '默认平台，支持浏览器直连（无需代理）。deepseek-chat 速度快，deepseek-reasoner 推理更强。',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    flavor: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    path: '/chat/completions',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini'],
    keyUrl: 'https://platform.openai.com/api-keys',
    useProxy: true,
    note: 'OpenAI 不允许浏览器直连（CORS 预检返回 403），因此默认经由本地 Dev Server 转发；若部署为纯静态站点，需要自建后端代理。',
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    flavor: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    path: '/v1/messages',
    models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-3-5-haiku-latest'],
    keyUrl: 'https://console.anthropic.com/settings/keys',
    useProxy: true,
    note: '使用 Anthropic Messages 协议。浏览器直连需要官方放行 CORS，默认经由本地 Dev Server 转发。',
  },
  {
    id: 'moonshot',
    name: 'Moonshot 月之暗面',
    flavor: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    path: '/chat/completions',
    models: ['kimi-k2-0905-preview', 'moonshot-v1-32k'],
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    flavor: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    path: '/chat/completions',
    models: ['glm-4.6', 'glm-4-plus', 'glm-4-flash'],
    keyUrl: 'https://bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'dashscope',
    name: '阿里云百炼（通义千问）',
    flavor: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    path: '/chat/completions',
    models: ['qwen3-max', 'qwen-plus', 'qwen-turbo'],
    keyUrl: 'https://bailian.console.aliyun.com/',
  },
  {
    id: 'siliconflow',
    name: '硅基流动 SiliconFlow',
    flavor: 'openai',
    baseUrl: 'https://api.siliconflow.cn/v1',
    path: '/chat/completions',
    models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen3-32B'],
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    flavor: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    path: '/chat/completions',
    models: ['anthropic/claude-sonnet-4.5', 'deepseek/deepseek-chat-v3.1'],
    keyUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'ollama',
    name: 'Ollama（本地）',
    flavor: 'openai',
    baseUrl: 'http://127.0.0.1:11434/v1',
    path: '/chat/completions',
    models: ['qwen2.5-coder:7b', 'llama3.1:8b'],
    note: '本地模型无需 API Key；需要先设置 OLLAMA_ORIGINS 允许浏览器跨域访问。',
  },
  {
    id: 'lmstudio',
    name: 'LM Studio（本地）',
    flavor: 'openai',
    baseUrl: 'http://127.0.0.1:1234/v1',
    path: '/chat/completions',
    models: ['local-model'],
    note: 'LM Studio 本地服务默认开启 CORS。',
  },
  {
    id: 'custom',
    name: '自定义平台',
    flavor: 'openai',
    baseUrl: '',
    path: '/chat/completions',
    models: [],
    note: '任何 OpenAI 兼容接口都能接入：填写 Base URL（通常以 /v1 结尾）、路径、模型名与 API Key 即可。',
  },
]

export const DEFAULT_PRESET_ID = 'deepseek'

export function getPreset(id: string): ProviderPreset {
  return PROVIDER_PRESETS.find((p) => p.id === id) ?? PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1]
}

export function createProfile(presetId: string, overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  const preset = getPreset(presetId)
  const now = Date.now()
  return {
    id: uid('prov'),
    name: preset.name,
    presetId: preset.id,
    flavor: preset.flavor,
    baseUrl: preset.baseUrl,
    path: preset.path,
    apiKey: '',
    model: preset.models[0] ?? '',
    models: [...preset.models],
    temperature: 0.4,
    maxTokens: 8192,
    extraHeaders: '',
    useProxy: preset.useProxy ?? false,
    anthropicVersion: preset.flavor === 'anthropic' ? '2023-06-01' : undefined,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function defaultSettings(): SettingsState {
  const profile = createProfile(DEFAULT_PRESET_ID)
  return {
    profiles: [profile],
    activeProfileId: profile.id,
    generation: {
      scopedStyle: true,
      themeAware: true,
      extraSystemPrompt: '',
    },
    ui: {
      theme: 'dark',
      isolation: 'shadow',
      autoReload: true,
      reloadDelay: 900,
      captureConsole: true,
      allowRemoteImports: true,
      showReasoning: false,
      workMode: 'project',
      leftPanelWidth: 340,
      historyCollapsed: false,
      historyWidth: 268,
    },
  }
}
