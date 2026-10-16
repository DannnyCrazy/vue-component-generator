import type { ComponentVersion } from '@/types'

/**
 * 接入文档生成：直接从组件的 SFC 源码里静态提取对外契约
 * （props / emits / slots / defineExpose / 依赖 / 接口），再拼成 Markdown。
 *
 * 之所以不交给模型写：这些信息在代码里本来就是确定的，静态提取既准确又免费，
 * 也不会出现「文档和代码对不上」的情况。
 */

export interface PropInfo {
  name: string
  type: string
  optional: boolean
  defaultValue?: string
  description?: string
}

export interface EmitInfo {
  name: string
  payload?: string
}

export interface SlotInfo {
  name: string
  props?: string
}

export interface ApiDependency {
  method: string
  url: string
}

export interface ComponentDoc {
  /** 展示名（可能包含中文，用于标题） */
  displayName: string
  /** 合法标识符（用于示例里的标签名与文件名） */
  componentName: string
  fileName: string
  /** 需求描述，作为概述 */
  summary: string
  lang: string
  scoped: boolean
  props: PropInfo[]
  emits: EmitInfo[]
  slots: SlotInfo[]
  exposes: string[]
  /** 除 vue 之外的 import（正常应为空） */
  thirdPartyImports: string[]
  /** 是否 import 了 http(s) 远程模块 */
  remoteImports: string[]
  /** 运行期实测调用过的接口 */
  apis: ApiDependency[]
  lines: number
  bytes: number
  /** 生成的 Markdown */
  markdown: string
}

/* ---------------- 基础解析工具 ---------------- */

/** 从 '{' 开始配平大括号，返回内部内容 */
function matchBraces(text: string, startIndex: number): string | null {
  if (text[startIndex] !== '{') return null
  let depth = 0
  for (let i = startIndex; i < text.length; i += 1) {
    const char = text[i]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(startIndex + 1, i)
    }
  }
  return null
}

/** 找到 `name<` 之后尖括号里的内容（只用于 defineProps/defineEmits 这类紧凑写法） */
function matchGeneric(text: string, marker: string): string | null {
  const at = text.indexOf(marker)
  if (at < 0) return null
  const open = text.indexOf('<', at)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    const char = text[i]
    if (char === '<') depth += 1
    else if (char === '>') {
      depth -= 1
      if (depth === 0) return text.slice(open + 1, i)
    }
  }
  return null
}

/** 按顶层分隔符切分（忽略括号/尖括号里的分隔符） */
function splitTopLevel(body: string, separators: string[] = [';', '\n']): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of body) {
    if ('{[(<'.includes(char)) depth += 1
    else if ('}])>'.includes(char)) depth = Math.max(0, depth - 1)

    if (depth === 0 && separators.includes(char)) {
      parts.push(current)
      current = ''
    } else {
      current += char
    }
  }
  if (current.trim()) parts.push(current)
  return parts.map((part) => part.trim()).filter(Boolean)
}

/** 取出结尾的 // 注释作为说明 */
function splitComment(entry: string): { code: string; comment?: string } {
  const match = /\/\/\s*(.+)$/.exec(entry)
  if (!match) return { code: entry }
  return { code: entry.slice(0, match.index).trim(), comment: match[1].trim() }
}

/** 把块注释统一成 // 注释，方便后面按行提取说明 */
function normalizeComments(body: string): string {
  return body.replace(/\/\*\*?([\s\S]*?)\*\//g, (_match, inner: string) => {
    const text = inner
      .split('\n')
      .map((line) => line.replace(/^\s*\*\s?/, '').trim())
      .filter(Boolean)
      .join(' ')
    return text ? `// ${text}` : ''
  })
}

/** 解析对象字面量的顶层键值对（用于 withDefaults 与运行时 defineProps） */
function parseObjectEntries(body: string): Array<{ key: string; value: string }> {
  const entries: Array<{ key: string; value: string }> = []
  for (const part of splitTopLevel(body, [','])) {
    const colon = part.indexOf(':')
    if (colon < 0) continue
    const key = part.slice(0, colon).trim().replace(/^['"]|['"]$/g, '')
    if (!key) continue
    entries.push({ key, value: part.slice(colon + 1).trim() })
  }
  return entries
}

/** 取出某个调用表达式括号里的参数文本 */
function matchCallArgs(text: string, marker: string): string | null {
  const at = text.indexOf(marker)
  if (at < 0) return null
  const open = text.indexOf('(', at)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1
    else if (text[i] === ')') {
      depth -= 1
      if (depth === 0) return text.slice(open + 1, i)
    }
  }
  return null
}

/* ---------------- 主体解析 ---------------- */

const TYPE_EXAMPLES: Array<[RegExp, string]> = [
  [/^string/, `'示例文本'`],
  [/^number/, '0'],
  [/^boolean/, 'true'],
  [/(\[\]|Array<)/, '[]'],
  [/^(Record|object|\{)/, '{}'],
  [/^(\(|Function|=>)/, '() => {}'],
]

function exampleFor(type: string): string {
  const normalized = type.trim().replace(/\s*\|\s*undefined$/, '')
  for (const [pattern, example] of TYPE_EXAMPLES) {
    if (pattern.test(normalized)) return example
  }
  if (normalized.includes('|')) return exampleFor(normalized.split('|')[0])
  return `'示例'`
}

function pascalCase(input: string): string {
  const words = input
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  const name = words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')
  const safe = name.replace(/[^\p{L}\p{N}]/gu, '')
  if (!safe) return 'GeneratedComponent'
  return /^\d/.test(safe) ? `C${safe}` : safe
}

/** 只保留 ASCII 词，拼成合法标识符（中文需求名会退化成 MyComponent） */
function safeIdentifier(input: string): string {
  const words = input.match(/[A-Za-z0-9]+/g) ?? []
  if (!words.length) return 'MyComponent'
  const name = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('')
  return /^\d/.test(name) ? `C${name}` : name
}

/** 优先用代码里 defineOptions({ name }) 的名字 */
function explicitName(script: string): string | null {
  const match = /defineOptions\s*\(\s*\{[\s\S]*?name\s*:\s*['"]([^'"]+)['"]/.exec(script)
  return match ? match[1] : null
}

function parseProps(script: string): PropInfo[] {
  const props: PropInfo[] = []

  // withDefaults(defineProps<...>(), { ... })：取第二个参数里的默认值
  const defaults = new Map<string, string>()
  const withDefaultsArgs = matchCallArgs(script, 'withDefaults(')
  if (withDefaultsArgs) {
    const args = splitTopLevel(withDefaultsArgs, [','])
    const second = args[1]
    if (second) {
      const braceAt = second.indexOf('{')
      const body = braceAt >= 0 ? matchBraces(second, braceAt) : null
      if (body) {
        for (const entry of parseObjectEntries(body)) defaults.set(entry.key, entry.value)
      }
    }
  }

  // 类型声明式：defineProps<{...}>() 或 defineProps<Props>()
  const generic = matchGeneric(script, 'defineProps<')
  if (generic) {
    let typeBody: string | null = null
    const braceAt = generic.indexOf('{')
    if (braceAt >= 0) {
      typeBody = matchBraces(generic, braceAt)
    } else {
      // 引用了 interface / type：去脚本里找
      const typeName = generic.trim().replace(/<.*$/, '').trim()
      const iface = new RegExp(`interface\\s+${typeName}\\s*`).exec(script)
      if (iface) {
        const at = script.indexOf('{', iface.index)
        if (at >= 0) typeBody = matchBraces(script, at)
      }
      if (!typeBody) {
        const alias = new RegExp(`type\\s+${typeName}\\s*=\\s*`).exec(script)
        if (alias) {
          const at = script.indexOf('{', alias.index)
          if (at >= 0) typeBody = matchBraces(script, at)
        }
      }
    }

    if (typeBody) {
      // 支持 /** 说明 */ 与 // 说明，且允许注释单独占一行
      let pending: string | undefined
      for (const raw of normalizeComments(typeBody).split(/\n/)) {
        for (const entry of splitTopLevel(raw)) {
          const { code, comment } = splitComment(entry)
          if (!code) {
            pending = comment ?? pending
            continue
          }
          const match = /^([\w$]+)\s*(\??)\s*:\s*([\s\S]+)$/.exec(code)
          if (!match) {
            pending = undefined
            continue
          }
          props.push({
            name: match[1],
            type: match[3].trim().replace(/\s+/g, ' '),
            optional: match[2] === '?',
            defaultValue: defaults.get(match[1]),
            description: comment || pending || undefined,
          })
          pending = undefined
        }
      }
    }
  }

  // 运行时声明式：defineProps({ title: { type: String, default: 'x' } })
  if (!props.length) {
    const at = script.indexOf('defineProps(')
    if (at >= 0) {
      const open = script.indexOf('{', at)
      const body = open >= 0 ? matchBraces(script, open) : null
      if (body) {
        for (const entry of parseObjectEntries(body)) {
          const typeMatch = /type\s*:\s*([\w$.]+)/.exec(entry.value)
          const defaultMatch = /default\s*:\s*([^,}]+)/.exec(entry.value)
          const required = /required\s*:\s*true/.test(entry.value)
          props.push({
            name: entry.key,
            type: typeMatch ? typeMatch[1] : 'any',
            optional: !required,
            defaultValue: defaultMatch ? defaultMatch[1].trim() : undefined,
          })
        }
      }
    }
  }

  return props
}

function parseEmits(script: string): EmitInfo[] {
  const emits: EmitInfo[] = []
  const seen = new Set<string>()

  const generic = matchGeneric(script, 'defineEmits<')
  if (generic) {
    const callPattern = /\(\s*e\s*:\s*['"]([\w:-]+)['"]\s*(?:,([\s\S]*?))?\)\s*:/g
    let match: RegExpExecArray | null
    while ((match = callPattern.exec(generic)) !== null) {
      if (seen.has(match[1])) continue
      seen.add(match[1])
      emits.push({ name: match[1], payload: match[2]?.trim().replace(/\s+/g, ' ') })
    }
    const namedPattern = /['"]([\w:-]+)['"]\s*:\s*\[([\s\S]*?)\]/g
    while ((match = namedPattern.exec(generic)) !== null) {
      if (seen.has(match[1])) continue
      seen.add(match[1])
      emits.push({ name: match[1], payload: match[2].trim().replace(/\s+/g, ' ') || undefined })
    }
  }

  if (!emits.length) {
    const at = script.indexOf('defineEmits(')
    if (at >= 0) {
      const open = script.indexOf('[', at)
      const close = open >= 0 ? script.indexOf(']', open) : -1
      if (open >= 0 && close > open) {
        for (const raw of script.slice(open + 1, close).split(',')) {
          const name = raw.trim().replace(/^['"]|['"]$/g, '')
          if (name && !seen.has(name)) {
            seen.add(name)
            emits.push({ name })
          }
        }
      }
    }
  }

  return emits
}

function parseSlots(template: string, script: string): SlotInfo[] {
  const slots: SlotInfo[] = []
  const seen = new Set<string>()

  const slotPattern = /<slot\b([^>]*?)\/?>/g
  let match: RegExpExecArray | null
  while ((match = slotPattern.exec(template)) !== null) {
    const attrs = match[1]
    const nameMatch = /\bname\s*=\s*["']([^"']+)["']/.exec(attrs)
    const name = nameMatch ? nameMatch[1] : 'default'
    if (seen.has(name)) continue
    seen.add(name)
    const bindings = [...attrs.matchAll(/:([\w-]+)\s*=\s*"([^"]*)"/g)].map(
      (item) => `${item[1]}: ${item[2]}`,
    )
    slots.push({ name, props: bindings.length ? bindings.join('; ') : undefined })
  }

  const generic = matchGeneric(script, 'defineSlots<')
  if (generic) {
    for (const entry of splitTopLevel(generic)) {
      const nameMatch = /^(?:\(\s*\)\s*:\s*)?([\w$]+)/.exec(entry.replace(/^\s*/, ''))
      if (!nameMatch) continue
      const name = nameMatch[1] === 'default' ? 'default' : nameMatch[1]
      if (seen.has(name) || name === 'void') continue
      seen.add(name)
      slots.push({ name })
    }
  }

  return slots
}

function parseExposes(script: string): string[] {
  const at = script.indexOf('defineExpose(')
  if (at < 0) return []
  const open = script.indexOf('{', at)
  const body = open >= 0 ? matchBraces(script, open) : null
  if (!body) return []
  return body
    .split(',')
    .map((item) => item.split(':')[0].trim())
    .filter((name) => /^[\w$]+$/.test(name))
}

function parseImports(script: string): { thirdParty: string[]; remote: string[] } {
  const thirdParty: string[] = []
  const remote: string[] = []
  const pattern = /import\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(script)) !== null) {
    const specifier = match[1]
    if (specifier === 'vue') continue
    if (/^https?:\/\//i.test(specifier)) remote.push(specifier)
    else thirdParty.push(specifier)
  }
  return { thirdParty: [...new Set(thirdParty)], remote: [...new Set(remote)] }
}

/* ---------------- 对外接口 ---------------- */

export function analyzeComponent(
  code: string,
  options: { name: string; summary: string; apis?: ApiDependency[] },
): ComponentDoc {
  const source = code ?? ''
  const script = /<script[^>]*>([\s\S]*?)<\/script>/i.exec(source)?.[1] ?? ''
  const scriptTag = /<script([^>]*)>/i.exec(source)?.[1] ?? ''
  const template = /<template[^>]*>([\s\S]*?)<\/template>/i.exec(source)?.[1] ?? ''
  const styles = [...source.matchAll(/<style([^>]*)>/gi)].map((item) => item[1])

  const props = parseProps(script)
  const emits = parseEmits(script)
  const slots = parseSlots(template, script)
  const exposes = parseExposes(script)
  const { thirdParty, remote } = parseImports(script)
  const displayName = options.name?.trim() || 'GeneratedComponent'
  const componentName = safeIdentifier(explicitName(script) ?? displayName)

  const doc: Omit<ComponentDoc, 'markdown'> = {
    displayName,
    componentName,
    fileName: `${componentName}.vue`,
    summary: options.summary,
    lang: /lang\s*=\s*["']ts["']/.test(scriptTag) ? 'TypeScript' : 'JavaScript',
    scoped: styles.some((attr) => /scoped/.test(attr)),
    props,
    emits,
    slots,
    exposes,
    thirdPartyImports: thirdParty,
    remoteImports: remote,
    apis: options.apis ?? [],
    lines: source ? source.split('\n').length : 0,
    bytes: new TextEncoder().encode(source).length,
  }

  return { ...doc, markdown: buildMarkdown(doc) }
}

/** 生成可直接粘进项目的使用示例 */
export function buildUsageExample(
  doc: Pick<ComponentDoc, 'componentName' | 'fileName' | 'props' | 'emits' | 'slots'>,
): string {
  const attrs = doc.props
    .filter((prop) => prop.defaultValue === undefined && !prop.optional)
    .map((prop) => `:${kebab(prop.name)}="${exampleFor(prop.type)}"`)
  const optionalAttrs = doc.props
    .filter((prop) => prop.defaultValue !== undefined || prop.optional)
    .slice(0, 3)
    .map((prop) => `:${kebab(prop.name)}="${exampleFor(prop.type)}"`)
  const events = doc.emits.map((emit) => `@${kebab(emit.name)}="on${pascalCase(emit.name)}"`)
  const namedSlots = doc.slots.filter((slot) => slot.name !== 'default')

  const openAttrs = [...attrs, ...optionalAttrs, ...events]
  const openTag = openAttrs.length
    ? [`  <${doc.componentName}`, ...openAttrs.map((attr) => `    ${attr}`), '  >'].join('\n')
    : `  <${doc.componentName}>`

  const lines = [openTag]
  if (doc.slots.some((slot) => slot.name === 'default')) {
    lines.push('    默认插槽内容')
  }
  for (const slot of namedSlots) {
    lines.push(`    <template #${slot.name}>${slot.name} 插槽内容</template>`)
  }
  lines.push(`  </${doc.componentName}>`)

  const handlers = doc.emits
    .map((emit) => {
      const payload = emit.payload ? `payload: ${emit.payload}` : ''
      return `function on${pascalCase(emit.name)}(${payload}): void {\n  // TODO: 处理 ${emit.name} 事件\n}`
    })
    .join('\n\n')

  return [
    '<template>',
    lines.join('\n'),
    '</template>',
    '',
    `<script setup lang="ts">`,
    `import ${doc.componentName} from './${doc.fileName}'`,
    handlers ? `\n${handlers}` : '',
    '</script>',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

export function buildMarkdown(doc: Omit<ComponentDoc, 'markdown'>): string {
  const lines: string[] = []

  lines.push(`# ${doc.displayName} 接入文档`, '')
  if (doc.summary) lines.push(`> ${doc.summary}`, '')

  lines.push('## 基本信息', '')
  lines.push('| 项 | 值 |', '| --- | --- |')
  lines.push(`| 文件 | \`${doc.fileName}\` |`)
  lines.push(`| 脚本语言 | ${doc.lang} |`)
  lines.push(`| 样式 | ${doc.scoped ? '`<style scoped>`（样式不外泄）' : '全局样式'} |`)
  lines.push(`| 代码规模 | ${doc.lines} 行 / ${(doc.bytes / 1024).toFixed(1)} KB |`)
  lines.push(
    `| 依赖 | ${
      doc.thirdPartyImports.length ? doc.thirdPartyImports.map((item) => `\`${item}\``).join('、') : '仅 `vue`，无第三方依赖'
    } |`,
  )
  if (doc.remoteImports.length) {
    lines.push(`| 远程模块 | ${doc.remoteImports.map((item) => `\`${item}\``).join('、')} |`)
  }
  lines.push('', '运行环境：Vue 3（Composition API），可直接放进任意 Vue 3 项目，无需额外构建配置。', '')

  lines.push('## Props', '')
  if (doc.props.length) {
    lines.push('| 名称 | 类型 | 必填 | 默认值 | 说明 |', '| --- | --- | --- | --- | --- |')
    for (const prop of doc.props) {
      lines.push(
        `| \`${prop.name}\` | \`${prop.type.replace(/\|/g, '\\|')}\` | ${prop.optional || prop.defaultValue !== undefined ? '否' : '是'} | ${
          prop.defaultValue !== undefined ? `\`${prop.defaultValue}\`` : '—'
        } | ${prop.description ?? '—'} |`,
      )
    }
  } else {
    lines.push('该组件不接收任何 props。')
  }
  lines.push('')

  lines.push('## Events', '')
  if (doc.emits.length) {
    lines.push('| 事件 | 载荷 | 说明 |', '| --- | --- | --- |')
    for (const emit of doc.emits) {
      lines.push(`| \`${emit.name}\` | ${emit.payload ? `\`${emit.payload.replace(/\|/g, '\\|')}\`` : '—'} | — |`)
    }
  } else {
    lines.push('该组件不对外派发事件。')
  }
  lines.push('')

  lines.push('## Slots', '')
  if (doc.slots.length) {
    lines.push('| 插槽 | 作用域参数 |', '| --- | --- |')
    for (const slot of doc.slots) {
      lines.push(`| \`${slot.name}\` | ${slot.props ? `\`${slot.props.replace(/\|/g, '\\|')}\`` : '—'} |`)
    }
  } else {
    lines.push('该组件不使用插槽。')
  }
  lines.push('')

  if (doc.exposes.length) {
    lines.push('## 暴露的方法 / 属性', '')
    lines.push('通过模板引用（`ref`）可以访问：', '')
    lines.push(doc.exposes.map((name) => `- \`${name}\``).join('\n'), '')
  }

  if (doc.apis.length) {
    lines.push('## 接口依赖', '', '组件运行期间实测会请求以下接口（来自工作台「接口」面板）：', '')
    lines.push('| 方法 | 地址 |', '| --- | --- |')
    for (const api of doc.apis) lines.push(`| ${api.method} | \`${api.url}\` |`)
    lines.push('')
  }

  lines.push('## 使用示例', '', '```vue', buildUsageExample(doc), '```', '')
  lines.push('---', '', `由 AI 组件工坊生成 · Vue 3 · ${new Date().toLocaleString('zh-CN')}`, '')

  return lines.join('\n')
}

/** 把版本信息拼进文档头部（用于下载的文件名与说明） */
export function describeVersion(version: ComponentVersion | null): string {
  if (!version) return ''
  const time = new Date(version.createdAt).toLocaleString('zh-CN')
  const model = version.model ? `${version.providerName || '未知平台'} · ${version.model}` : '未知模型'
  return `${time} · ${model}`
}
