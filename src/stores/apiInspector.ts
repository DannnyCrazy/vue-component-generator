import { reactive } from 'vue'
import { textOf, truncate, uid } from '@/utils/misc'

/**
 * 接口采集与测试。
 *
 * 预览组件挂载期间，临时接管 window.fetch 与 XMLHttpRequest，
 * 把组件自身发起的请求记录下来，供「接口管理」面板查看、编辑与重发测试。
 *
 * 工作台自己发出的请求（调用 AI 平台、拉取模型列表、加载远程模块）会通过
 * pauseCapture() 显式排除，避免污染列表。
 */

export interface CapturedApi {
  id: string
  method: string
  url: string
  headers: Record<string, string>
  /** 请求体文本（非文本请求体为空，见 hasBinaryBody） */
  body: string
  hasBinaryBody: boolean
  status: number | null
  ok: boolean
  durationMs: number
  responseBody: string
  responseType: string
  error: string
  startedAt: number
  /** 同一 method + url 被调用的次数 */
  count: number
  kind: 'fetch' | 'xhr'
}

export interface ApiTestResult {
  at: number
  status: number | null
  ok: boolean
  durationMs: number
  body: string
  error: string
}

const MAX_ENDPOINTS = 40
const MAX_TEXT = 4000

export const apiState = reactive({
  capturing: false,
  calls: [] as CapturedApi[],
  selectedId: '',
  testing: false,
  test: null as ApiTestResult | null,
})

/** 始终指向未被接管的原生 fetch，测试请求用它发出，避免被自己采集 */
const nativeFetch: typeof fetch = window.fetch.bind(window)

let pauseDepth = 0

export function pauseCapture(): void {
  pauseDepth += 1
}

export function resumeCapture(): void {
  if (pauseDepth > 0) pauseDepth -= 1
}

function shouldCapture(): boolean {
  return apiState.capturing && pauseDepth === 0
}

function normalizeHeaders(input: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!input) return out
  if (input instanceof Headers) {
    input.forEach((value, key) => {
      out[key] = value
    })
  } else if (Array.isArray(input)) {
    for (const [key, value] of input) out[String(key)] = String(value)
  } else {
    for (const [key, value] of Object.entries(input)) out[key] = String(value)
  }
  return out
}

function statusClassOf(call: CapturedApi): string {
  if (call.error) return 'err'
  if (call.status === null) return 'pending'
  if (call.status >= 200 && call.status < 400) return 'ok'
  return 'err'
}

export { statusClassOf }

/* ---------------- 记录 ---------------- */

function upsert(record: Omit<CapturedApi, 'id' | 'count'>): CapturedApi {
  const existing = apiState.calls.find((item) => item.method === record.method && item.url === record.url)
  if (existing) {
    const count = existing.count + 1
    Object.assign(existing, record, { count })
    return existing
  }
  const created: CapturedApi = { ...record, id: uid('api'), count: 1 }
  apiState.calls.unshift(created)
  if (apiState.calls.length > MAX_ENDPOINTS) apiState.calls.splice(MAX_ENDPOINTS)
  if (!apiState.selectedId) apiState.selectedId = created.id
  return created
}

function emptyRecord(method: string, url: string, kind: CapturedApi['kind']): Omit<CapturedApi, 'id' | 'count'> {
  return {
    method: method.toUpperCase(),
    url,
    headers: {},
    body: '',
    hasBinaryBody: false,
    status: null,
    ok: false,
    durationMs: 0,
    responseBody: '',
    responseType: '',
    error: '',
    startedAt: Date.now(),
    kind,
  }
}

async function finalizeFetch(
  pending: Omit<CapturedApi, 'id' | 'count'>,
  started: number,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): Promise<Response> {
  try {
    const response = await nativeFetch(input as RequestInfo, init)
    pending.status = response.status
    pending.ok = response.ok
    pending.durationMs = performance.now() - started
    pending.responseType = response.headers.get('content-type') ?? ''
    upsert(pending)
    // SSE 等流式响应不读取副本，避免把流缓存下来
    if (!pending.responseType.includes('text/event-stream')) {
      response
        .clone()
        .text()
        .then((text) => {
          pending.responseBody = truncate(text, MAX_TEXT)
          const target = apiState.calls.find((item) => item.method === pending.method && item.url === pending.url)
          if (target) target.responseBody = pending.responseBody
        })
        .catch(() => {})
    }
    return response
  } catch (error) {
    pending.error = textOf(error)
    pending.durationMs = performance.now() - started
    upsert(pending)
    throw error
  }
}

async function patchedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!shouldCapture()) return nativeFetch(input as RequestInfo, init)

  let url = ''
  let method = 'GET'
  let headers: Record<string, string> = {}
  let body = ''
  let hasBinaryBody = false

  try {
    if (typeof Request !== 'undefined' && input instanceof Request) {
      url = input.url
      method = input.method || 'GET'
      headers = normalizeHeaders(input.headers)
      if (input.body) body = await input.clone().text()
    } else {
      url = String(input)
      method = init?.method ?? 'GET'
      headers = normalizeHeaders(init?.headers)
      if (typeof init?.body === 'string') body = init.body
      else if (init?.body) hasBinaryBody = true
    }
  } catch {
    /* 读取请求信息失败时仍然放行请求 */
  }

  const pending = emptyRecord(method, url, 'fetch')
  pending.headers = headers
  pending.body = truncate(body, MAX_TEXT)
  pending.hasBinaryBody = hasBinaryBody

  const started = performance.now()
  return finalizeFetch(pending, started, input, init)
}

/* ---------------- XMLHttpRequest ---------------- */

type XhrEntry = { pending: Omit<CapturedApi, 'id' | 'count'>; started: number }

let originalOpen: typeof XMLHttpRequest.prototype.open | null = null
let originalSend: typeof XMLHttpRequest.prototype.send | null = null
let originalSetHeader: typeof XMLHttpRequest.prototype.setRequestHeader | null = null
const xhrEntries = new WeakMap<XMLHttpRequest, XhrEntry>()

function patchXhr(): void {
  if (originalOpen) return
  originalOpen = XMLHttpRequest.prototype.open
  originalSend = XMLHttpRequest.prototype.send
  originalSetHeader = XMLHttpRequest.prototype.setRequestHeader

  XMLHttpRequest.prototype.open = function open(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    if (shouldCapture()) {
      const pending = emptyRecord(String(method), String(url), 'xhr')
      xhrEntries.set(this, { pending, started: 0 })
      this.addEventListener('loadend', () => {
        const entry = xhrEntries.get(this)
        if (!entry) return
        entry.pending.durationMs = performance.now() - entry.started
        entry.pending.status = this.status || null
        entry.pending.ok = this.status >= 200 && this.status < 400
        entry.pending.responseType = this.getResponseHeader('content-type') ?? ''
        if (this.responseType === '' || this.responseType === 'text') {
          try {
            entry.pending.responseBody = truncate(this.responseText ?? '', MAX_TEXT)
          } catch {
            /* responseType 不兼容时忽略 */
          }
        }
        upsert(entry.pending)
      })
    }
    return (originalOpen as NonNullable<typeof originalOpen>).apply(this, [method, url, ...rest] as never)
  } as typeof XMLHttpRequest.prototype.open

  XMLHttpRequest.prototype.send = function send(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const entry = xhrEntries.get(this)
    if (entry) {
      entry.started = performance.now()
      if (typeof body === 'string') entry.pending.body = truncate(body, MAX_TEXT)
      else if (body) entry.pending.hasBinaryBody = true
    }
    return (originalSend as NonNullable<typeof originalSend>).call(this, body ?? null)
  }

  XMLHttpRequest.prototype.setRequestHeader = function setRequestHeader(this: XMLHttpRequest, name: string, value: string) {
    const entry = xhrEntries.get(this)
    if (entry) entry.pending.headers[name] = value
    return (originalSetHeader as NonNullable<typeof originalSetHeader>).call(this, name, value)
  }
}

function unpatchXhr(): void {
  if (!originalOpen) return
  XMLHttpRequest.prototype.open = originalOpen
  XMLHttpRequest.prototype.send = originalSend as NonNullable<typeof originalSend>
  XMLHttpRequest.prototype.setRequestHeader = originalSetHeader as NonNullable<typeof originalSetHeader>
  originalOpen = null
  originalSend = null
  originalSetHeader = null
}

/* ---------------- 采集开关 ---------------- */

let originalFetch: typeof window.fetch | null = null

export function startCapture(): void {
  if (apiState.capturing) return
  apiState.capturing = true
  originalFetch = window.fetch
  window.fetch = patchedFetch as typeof window.fetch
  patchXhr()
}

export function stopCapture(): void {
  if (!apiState.capturing) return
  apiState.capturing = false
  if (originalFetch) {
    window.fetch = originalFetch
    originalFetch = null
  }
  unpatchXhr()
}

export function clearCalls(): void {
  apiState.calls.splice(0, apiState.calls.length)
  apiState.selectedId = ''
  apiState.test = null
}

/* ---------------- 采集作用域：跟着当前组件走 ---------------- */

let currentScopeId = ''

/**
 * 切换采集作用域。同一时间只开发一个组件，因此换了组件 id 就清空列表，
 * 保证「接口」面板里永远是当前这个组件的请求。
 */
export function setCaptureScope(scopeId: string): void {
  const id = scopeId || 'draft'
  if (id === currentScopeId) return
  currentScopeId = id
  clearCalls()
}

/** 组件被清空时调用，只重置作用域标记 */
export function resetCaptureScope(): void {
  currentScopeId = ''
  clearCalls()
}

/* ---------------- 测试（重发） ---------------- */

export async function sendTest(request: {
  method: string
  url: string
  headers: Record<string, string>
  body: string
}): Promise<void> {
  const method = request.method.toUpperCase()
  apiState.testing = true
  const started = performance.now()
  try {
    const response = await nativeFetch(request.url, {
      method,
      headers: request.headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : request.body || undefined,
    })
    const text = await response.text()
    apiState.test = {
      at: Date.now(),
      status: response.status,
      ok: response.ok,
      durationMs: performance.now() - started,
      body: truncate(text, 8000),
      error: '',
    }
  } catch (error) {
    apiState.test = {
      at: Date.now(),
      status: null,
      ok: false,
      durationMs: performance.now() - started,
      body: '',
      error: textOf(error),
    }
  } finally {
    apiState.testing = false
  }
}
