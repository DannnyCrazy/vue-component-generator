/** 从模型输出中提取可直接编译的 Vue SFC 代码 */

export interface ExtractedCode {
  /** 提取到的代码 */
  code: string
  /** 是否提取到内容 */
  found: boolean
  /** SFC 是否已完整（闭合标签齐全），用于流式期间判断能否编译 */
  complete: boolean
  language: string
}

const FENCE_RE = /```([a-zA-Z0-9_+#-]*)[ \t]*\r?\n([\s\S]*?)(?:\r?\n?```|$)/g

interface Candidate {
  language: string
  body: string
  closed: boolean
}

function collectCandidates(text: string): Candidate[] {
  const candidates: Candidate[] = []
  FENCE_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = FENCE_RE.exec(text)) !== null) {
    const language = (match[1] || '').toLowerCase()
    const body = match[2] ?? ''
    const closed = /```\s*$/.test(match[0])
    candidates.push({ language, body, closed })
  }
  return candidates
}

function stripNoise(body: string): string {
  let code = body.replace(/\r\n/g, '\n')
  // 去掉残余的代码块围栏行
  code = code
    .split('\n')
    .filter((line) => !/^\s*```/.test(line))
    .join('\n')
  return code.trim()
}

function isVueLike(candidate: Candidate): boolean {
  if (candidate.language === 'vue' || candidate.language === 'html') return true
  return /<template[\s>]/i.test(candidate.body) || /<script[\s>]/i.test(candidate.body)
}

/** 判断一个 SFC 字符串的标签是否已经闭合 */
export function isSfcComplete(code: string): boolean {
  if (!/<template[\s>]/i.test(code)) return false
  if (!/<\/template>/i.test(code)) return false
  if (/<script[\s>]/i.test(code) && !/<\/script>/i.test(code)) return false
  if (/<style[\s>]/i.test(code) && !/<\/style>/i.test(code)) return false
  return true
}

/**
 * 优先取「代码块」形式的输出；若模型直接输出裸 SFC（流式过程中很常见），
 * 则从第一个 <template>/<script> 标签开始截取到结尾。
 */
export function extractComponentCode(text: string): ExtractedCode {
  if (!text || !text.trim()) return { code: '', found: false, complete: false, language: '' }

  const candidates = collectCandidates(text)
  const vueCandidates = candidates.filter(isVueLike)
  const pool = vueCandidates.length ? vueCandidates : []

  if (pool.length) {
    // 优先已闭合且包含完整结构的；否则取最长的一段（流式过程中代码会持续增长）
    const sorted = [...pool].sort((a, b) => {
      const aComplete = isSfcComplete(a.body) ? 1 : 0
      const bComplete = isSfcComplete(b.body) ? 1 : 0
      if (aComplete !== bComplete) return bComplete - aComplete
      return b.body.length - a.body.length
    })
    const best = sorted[0]
    const code = stripNoise(best.body)
    return { code, found: true, complete: isSfcComplete(code), language: best.language || 'vue' }
  }

  // 没有代码块：尝试从裸文本中截取
  const startMatch = /<template[\s>]|<script[\s>]/i.exec(text)
  if (startMatch) {
    const code = stripNoise(text.slice(startMatch.index))
    if (code) {
      return { code, found: true, complete: isSfcComplete(code), language: 'vue' }
    }
  }

  return { code: '', found: false, complete: false, language: '' }
}

/** 粗略判断流式文本里是否已经开始输出组件代码 */
export function looksLikeComponentOutput(text: string): boolean {
  return /<template[\s>]/i.test(text) || /```vue/i.test(text) || /<script setup/i.test(text)
}
