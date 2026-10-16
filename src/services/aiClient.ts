import type { ApiFlavor, ChatMessage, ProviderProfile } from '@/types'
import { pauseCapture, resumeCapture } from '@/stores/apiInspector'
import { textOf } from '@/utils/misc'

/** 本地开发服务器提供的同源转发端点（见 server/aiProxyPlugin.ts） */
export const AI_PROXY_PATH = '/__ai_proxy__'

export class AiError extends Error {
  status?: number
  detail?: string
  hint?: string

  constructor(message: string, options: { status?: number; detail?: string; hint?: string } = {}) {
    super(message)
    this.name = 'AiError'
    this.status = options.status
    this.detail = options.detail
    this.hint = options.hint
  }
}

export interface StreamDelta {
  content: string
  reasoning: string
}

export interface StreamResult {
  content: string
  reasoning: string
  /** 非流式响应或统计信息（若有） */
  usage?: unknown
}

export interface StreamOptions {
  signal?: AbortSignal
  /** 是否使用流式输出，默认 true */
  stream?: boolean
  /** 覆盖默认的最大输出 tokens */
  maxTokens?: number
  onDelta?: (delta: StreamDelta) => void
}

export function defaultPath(flavor: ApiFlavor): string {
  return flavor === 'anthropic' ? '/v1/messages' : '/chat/completions'
}

/** 组合出真正的请求地址，兼容用户直接粘贴完整 URL 的情况 */
export function resolveEndpoint(provider: ProviderProfile): string {
  const base = (provider.baseUrl || '').trim().replace(/\/+$/, '')
  if (!base) {
    throw new AiError('还没有填写接口地址（Base URL）', {
      hint: '打开右上角「设置 → AI 平台」，填写形如 https://api.deepseek.com/v1 的地址。',
    })
  }
  if (!/^https?:\/\//i.test(base)) {
    throw new AiError('接口地址必须以 http:// 或 https:// 开头', { hint: `当前填写的是：${base}` })
  }
  let path = (provider.path || '').trim() || defaultPath(provider.flavor)
  if (!path.startsWith('/')) path = `/${path}`
  if (base.endsWith(path)) return base
  if (/\/(chat\/completions|completions|messages|responses)$/i.test(base)) return base
  return `${base}${path}`
}

export function buildHeaders(provider: ProviderProfile): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const key = (provider.apiKey || '').trim()

  if (provider.flavor === 'anthropic') {
    if (key) headers['x-api-key'] = key
    headers['anthropic-version'] = provider.anthropicVersion || '2023-06-01'
    headers['anthropic-dangerous-direct-browser-access'] = 'true'
  } else if (key) {
    headers['authorization'] = `Bearer ${key}`
  }

  const extra = (provider.extraHeaders || '').trim()
  if (extra) {
    try {
      const parsed = JSON.parse(extra) as Record<string, unknown>
      for (const [name, value] of Object.entries(parsed)) {
        headers[name] = typeof value === 'string' ? value : JSON.stringify(value)
      }
    } catch {
      throw new AiError('「额外请求头」不是合法的 JSON', {
        hint: '请按 {"X-Custom":"value"} 的格式填写，或留空。',
      })
    }
  }

  return headers
}

export function buildRequestBody(
  provider: ProviderProfile,
  messages: ChatMessage[],
  stream: boolean,
  maxTokens?: number,
): Record<string, unknown> {
  const model = (provider.model || '').trim()
  if (!model) {
    throw new AiError('还没有填写模型名', { hint: '例如 DeepSeek 可填 deepseek-chat，或点击「拉取模型列表」。' })
  }
  const limit = maxTokens ?? provider.maxTokens
  // 部分推理模型（如 deepseek-reasoner）不接受 temperature，做一次保护
  const supportsTemperature = !/reasoner|o1|o3|o4|thinking/i.test(model)

  if (provider.flavor === 'anthropic') {
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n')
    const rest = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
    return {
      model,
      max_tokens: limit || 4096,
      ...(supportsTemperature ? { temperature: provider.temperature } : {}),
      ...(system ? { system } : {}),
      messages: rest,
      stream,
    }
  }

  return {
    model,
    messages,
    stream,
    ...(supportsTemperature ? { temperature: provider.temperature } : {}),
    ...(limit ? { max_tokens: limit } : {}),
  }
}

function contentToText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object') {
          const record = part as Record<string, unknown>
          if (typeof record.text === 'string') return record.text
        }
        return ''
      })
      .join('')
  }
  return ''
}

function pickDelta(json: unknown, flavor: ApiFlavor): StreamDelta {
  if (!json || typeof json !== 'object') return { content: '', reasoning: '' }
  const data = json as Record<string, any>

  if (flavor === 'anthropic') {
    if (data.type === 'content_block_delta') {
      const delta = (data.delta ?? {}) as Record<string, unknown>
      if (typeof delta.text === 'string') return { content: delta.text, reasoning: '' }
      if (typeof delta.thinking === 'string') return { content: '', reasoning: delta.thinking }
      if (typeof delta.partial_json === 'string') return { content: delta.partial_json, reasoning: '' }
    }
    return { content: '', reasoning: '' }
  }

  const choice = Array.isArray(data.choices) ? data.choices[0] : undefined
  if (!choice) return { content: '', reasoning: '' }
  const delta = (choice.delta ?? choice.message ?? {}) as Record<string, unknown>
  return {
    content: contentToText(delta.content),
    reasoning: contentToText(delta.reasoning_content ?? delta.reasoning),
  }
}

function pickFullResponse(json: unknown, flavor: ApiFlavor): StreamDelta {
  if (!json || typeof json !== 'object') return { content: '', reasoning: '' }
  const data = json as Record<string, any>

  if (flavor === 'anthropic') {
    const content = contentToText(data.content)
    return { content, reasoning: contentToText(data.thinking) }
  }

  const choice = Array.isArray(data.choices) ? data.choices[0] : undefined
  if (!choice) return { content: '', reasoning: '' }
  const message = (choice.message ?? choice.delta ?? {}) as Record<string, unknown>
  return {
    content: contentToText(message.content),
    reasoning: contentToText(message.reasoning_content ?? message.reasoning),
  }
}

function parseJson(raw: string): Record<string, any> | null {
  try {
    const value = JSON.parse(raw)
    return value && typeof value === 'object' ? (value as Record<string, any>) : null
  } catch {
    return null
  }
}

function serverMessage(raw: string): string {
  const parsed = parseJson(raw)
  if (!parsed) return ''
  const err = parsed.error
  if (typeof err === 'string') return err
  if (err && typeof err === 'object') {
    const message = (err as Record<string, unknown>).message
    if (typeof message === 'string') return message
  }
  if (typeof parsed.message === 'string') return parsed.message
  if (typeof parsed.detail === 'string') return parsed.detail
  return ''
}

function describeHttpError(status: number, raw: string): AiError {
  const detail = serverMessage(raw) || raw.slice(0, 600)
  const table: Record<number, { message: string; hint: string }> = {
    400: { message: '请求参数被平台拒绝（400）', hint: '检查模型名、Base URL 与路径是否正确。' },
    401: { message: 'API Key 无效或未授权（401）', hint: '请重新复制 API Key，注意不要有多余空格。' },
    402: { message: '账户余额不足（402）', hint: '请前往平台充值后重试。' },
    403: { message: '没有访问该模型的权限（403）', hint: '确认该 Key 已开通对应模型，或更换模型。' },
    404: { message: '接口地址或模型不存在（404）', hint: '检查 Base URL 是否包含 /v1，路径是否为 /chat/completions。' },
    413: { message: '请求体过大（413）', hint: '精简需求描述或降低最大输出 tokens。' },
    422: { message: '请求参数不合法（422）', hint: '检查温度、最大 tokens 等参数。' },
    429: { message: '触发速率或额度限制（429）', hint: '稍等片刻再试，或降低请求频率。' },
    500: { message: '平台服务异常（500）', hint: '稍后重试。' },
    502: { message: '平台网关异常（502）', hint: '稍后重试。' },
    503: { message: '平台暂时不可用（503）', hint: '稍后重试。' },
    504: { message: '平台响应超时（504）', hint: '稍后重试或更换模型。' },
  }
  const known = table[status]
  if (known) return new AiError(known.message, { status, detail, hint: known.hint })
  if (status >= 500) return new AiError(`平台服务异常（${status}）`, { status, detail, hint: '稍后重试。' })
  return new AiError(`请求失败（HTTP ${status}）`, { status, detail })
}

function networkHint(provider: ProviderProfile): string {
  const hints = [
    '可能是网络不通、地址写错，或浏览器 CORS 策略拦截（很多平台不允许网页直连）。',
  ]
  if (!provider.useProxy) {
    hints.push('可在「设置 → AI 平台」中打开「经由本地开发服务器转发」，由本机代理请求以绕过 CORS。')
  } else {
    hints.push('本地代理已开启：请确认开发服务器仍在运行，且该平台允许服务器侧访问。')
  }
  return hints.join('')
}

async function post(
  provider: ProviderProfile,
  endpoint: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Response> {
  const url = provider.useProxy ? AI_PROXY_PATH : endpoint
  const init: RequestInit = provider.useProxy
    ? {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: endpoint, method: 'POST', headers, body }),
        signal,
      }
    : { method: 'POST', headers, body: JSON.stringify(body), signal }

  try {
    // 工作台自己的请求不计入「接口管理」的采集列表
    pauseCapture()
    try {
      return await fetch(url, init)
    } finally {
      resumeCapture()
    }
  } catch (error) {
    if (signal?.aborted) throw new AiError('已取消生成')
    throw new AiError(`无法连接到 ${new URL(endpoint).host}`, {
      detail: textOf(error),
      hint: networkHint(provider),
    })
  }
}

/**
 * 向所选平台发起一次对话请求，支持流式回调。
 * 兼容 OpenAI Chat Completions、Anthropic Messages 以及 DeepSeek 的 reasoning_content。
 */
export async function streamChat(
  provider: ProviderProfile,
  messages: ChatMessage[],
  options: StreamOptions = {},
): Promise<StreamResult> {
  const endpoint = resolveEndpoint(provider)
  const headers = buildHeaders(provider)
  const useStream = options.stream !== false
  const body = buildRequestBody(provider, messages, useStream, options.maxTokens)

  const response = await post(provider, endpoint, headers, body, options.signal)

  if (!response.ok) {
    const raw = await response.text().catch(() => '')
    throw describeHttpError(response.status, raw)
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase()
  if (!useStream || contentType.includes('application/json')) {
    const text = await response.text()
    const json = parseJson(text)
    if (!json) {
      throw new AiError('平台返回了无法解析的内容', { detail: text.slice(0, 800) })
    }
    const inlineError = json.error
    if (inlineError) {
      throw new AiError(serverMessage(text) || '模型返回了错误', { detail: text.slice(0, 800) })
    }
    const picked = pickFullResponse(json, provider.flavor)
    if (picked.content || picked.reasoning) options.onDelta?.(picked)
    return { content: picked.content, reasoning: picked.reasoning, usage: json.usage }
  }

  if (!response.body) {
    throw new AiError('平台响应没有可读取的数据流', { hint: '可尝试关闭流式输出或更换模型。' })
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let content = ''
  let reasoning = ''
  let usage: unknown

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const events = buffer.split(/\r?\n\r?\n/)
      buffer = events.pop() ?? ''

      for (const event of events) {
        const dataLines: string[] = []
        for (const line of event.split(/\r?\n/)) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith(':') || trimmed.startsWith('event:')) continue
          if (trimmed.startsWith('data:')) dataLines.push(trimmed.slice(5).trim())
        }
        if (!dataLines.length) continue
        const payload = dataLines.join('\n')
        if (!payload || payload === '[DONE]') continue

        const json = parseJson(payload)
        if (!json) continue
        if (json.error) {
          throw new AiError(serverMessage(payload) || '模型返回了错误', { detail: payload.slice(0, 800) })
        }
        if (json.usage) usage = json.usage
        const delta = pickDelta(json, provider.flavor)
        if (delta.content) content += delta.content
        if (delta.reasoning) reasoning += delta.reasoning
        if (delta.content || delta.reasoning) options.onDelta?.(delta)
      }
    }
  } finally {
    reader.releaseLock()
  }

  if (!content && !reasoning) {
    throw new AiError('平台没有返回任何内容', {
      hint: '可能是模型名不正确，或该平台要求不同的参数格式；可在设置中更换模型后重试。',
    })
  }

  return { content, reasoning, usage }
}

/** 拉取平台模型列表（GET {base}/models） */
export async function listModels(provider: ProviderProfile, signal?: AbortSignal): Promise<string[]> {
  const base = (provider.baseUrl || '').trim().replace(/\/+$/, '')
  if (!base) throw new AiError('请先填写 Base URL')
  const endpoint = provider.flavor === 'anthropic' ? `${base}/v1/models` : `${base}/models`
  const headers = buildHeaders(provider)
  delete headers['content-type']

  let response: Response
  try {
    pauseCapture()
    try {
      response = provider.useProxy
        ? await fetch(AI_PROXY_PATH, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ url: endpoint, method: 'GET', headers }),
            signal,
          })
        : await fetch(endpoint, { method: 'GET', headers, signal })
    } finally {
      resumeCapture()
    }
  } catch (error) {
    if (signal?.aborted) throw new AiError('已取消')
    throw new AiError('无法获取模型列表', { detail: textOf(error), hint: networkHint(provider) })
  }

  if (!response.ok) {
    const raw = await response.text().catch(() => '')
    throw describeHttpError(response.status, raw)
  }

  const data = (await response.json().catch(() => null)) as Record<string, any> | null
  const raw = Array.isArray(data?.data) ? data?.data : Array.isArray(data?.models) ? data?.models : []
  const models = (raw as unknown[])
    .map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>
        return typeof record.id === 'string' ? record.id : typeof record.name === 'string' ? record.name : ''
      }
      return ''
    })
    .filter((name): name is string => Boolean(name))

  if (!models.length) {
    throw new AiError('平台没有返回可用的模型列表', { hint: '可以手动填写模型名。' })
  }
  return models.sort()
}

/** 连通性测试：发一条极短的请求，确认地址 / Key / 模型都可用 */
export async function testProvider(
  provider: ProviderProfile,
  signal?: AbortSignal,
): Promise<{ ms: number; sample: string }> {
  const started = performance.now()
  const result = await streamChat(provider, [{ role: 'user', content: '只回复两个字：正常' }], {
    stream: false,
    maxTokens: 32,
    signal,
  })
  return { ms: performance.now() - started, sample: (result.content || '').slice(0, 60) }
}
