/** 通用小工具 */

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as T
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 超出配额或隐私模式，忽略 */
  }
}

export interface Debounced<A extends unknown[]> {
  (...args: A): void
  cancel(): void
  flush(): void
  pending(): boolean
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, wait: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastArgs: A | null = null

  const invoke = () => {
    timer = null
    const args = lastArgs
    lastArgs = null
    if (args) fn(...args)
  }

  const debounced = ((...args: A) => {
    lastArgs = args
    if (timer) clearTimeout(timer)
    timer = setTimeout(invoke, wait)
  }) as Debounced<A>

  debounced.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
    lastArgs = null
  }
  debounced.flush = () => {
    if (timer) {
      clearTimeout(timer)
      invoke()
    }
  }
  debounced.pending = () => timer !== null
  return debounced
}

export function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (sameDay) return `今天 ${time}`
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

export function textOf(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function titleFromPrompt(prompt: string, max = 24): string {
  const clean = prompt.replace(/\s+/g, ' ').trim()
  if (!clean) return '未命名组件'
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

/** 按字节长度截断，用于日志展示 */
export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}
