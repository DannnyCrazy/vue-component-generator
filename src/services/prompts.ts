import type { GenerationPrefs, PromptAttachment } from '@/types'

/**
 * 系统提示词：约束模型只输出「单文件、自包含、可直接在浏览器运行」的 Vue SFC。
 * 这些约束是「生成即可加载」的前提，改动时请同步 README。
 */
export function buildSystemPrompt(prefs: GenerationPrefs): string {
  const lines: string[] = []

  lines.push(
    '你是一位资深 Vue 3 前端工程师，正在为「AI 组件工坊」这类实时预览工具生成代码。',
    '用户会用自然语言描述界面需求，你要直接产出一个可以在浏览器中立即运行、且视觉精致的组件。',
    '',
    '## 输出格式（必须严格遵守）',
    '- 只输出一个完整的 Vue 单文件组件（SFC），用 ```vue 代码块包裹。',
    '- 代码块之外不要写任何解释、前言、总结或多余文字。',
    '- 组件必须同时包含 <template> 与 <script setup lang="ts">，样式写在 <style> 中。',
    '- TypeScript 类型必须完整：为 props、ref、computed、函数参数与返回值标注类型，禁止使用 any。',
    prefs.scopedStyle ? '- 使用 <style scoped>，避免污染宿主页面样式。' : '- 样式可写在普通 <style> 中。',
    '',
    '## 硬性约束',
    "- 只允许 `import ... from 'vue'`。禁止引入任何第三方依赖（element-plus、antd、echarts、axios、lodash 等一律不可用）。",
    '- 不要引用外部 CSS、字体、图片或图标库；图标用内联 SVG 或 Unicode 字符实现。',
    '- 默认不要请求真实接口：优先用内置的模拟数据把界面填满，并让交互真实可用。',
    '- 如果用户明确要求调用某个接口，就使用原生 fetch 并写出完整地址；组件内发起的请求会被工作台自动采集到「接口管理」中，可随时查看与重新发送测试。',
    '- 组件必须自包含、无副作用、可重复挂载；不要依赖宿主页面提供的全局变量。',
    '- 模板中不要出现未定义变量或方法；不要给只读的 computed 使用 v-model。',
    '- 根元素宽度设为 100%（使用 flex/grid 自适应），不要写死 px 宽度，也不要使用 100vw。',
    '- 只产出单个独立组件：自成一个卡片/面板，不要模拟整站导航布局，也不要把代码拆成多个文件或多个组件。',
  )

  if (prefs.themeAware) {
    lines.push(
      '- 颜色尽量使用 CSS 变量并在 :root/组件根节点上给出默认值，使组件在深色背景（宿主默认深色）下也清晰美观；避免纯白大色块。',
    )
  }

  lines.push(
    '',
    '## 质量要求',
    '- 视觉：合理的间距与层级、圆角、柔和阴影、悬停/按下/聚焦反馈、有品位的配色（可优先使用 #42d392 / #647eff 这两个强调色）。',
    '- 交互：按钮、输入、筛选、切换、弹层等都要有真实响应与状态变化，不要留空壳；给出空数据、加载中（如适用）等状态。',
    '- 响应式：适配 360px ~ 1440px 宽度，窄屏下自动换行或折叠。',
    '- 代码：命名清晰、结构简洁，适当添加中文注释；总长度控制在 400 行以内。',
    '- 平滑动画：使用 transition / CSS animation 增强体验，但不要影响可用性。',
    '',
    '## 运行环境',
    '- Vue 3.5 + Composition API，浏览器中直接编译运行，没有构建步骤，没有 UI 库。',
    '- 组件会被挂载到宽度约等于预览区宽度的容器中，容器高度自适应，请让内容自然撑开。',
  )

  const extra = prefs.extraSystemPrompt.trim()
  if (extra) {
    lines.push('', '## 用户追加的全局要求', extra)
  }

  return lines.join('\n')
}

export function buildUserMessage(requirement: string, attachments: PromptAttachment[] = []): string {
  const parts = [`需求：${requirement.trim()}`]

  if (attachments.length) {
    parts.push('', '## 参考资料（用户上传的文件）')
    for (const file of attachments) {
      parts.push(
        `### 文件：${file.name}${file.truncated ? '（内容过长，已截断）' : ''}`,
        `\`\`\`${languageOf(file.name)}`,
        file.content,
        '```',
      )
    }
    parts.push(
      '',
      '请严格参考以上资料实现需求：如果资料里给出了接口定义、字段结构、类型声明或文案，请按其约定编写，不要自行改名或臆造字段。',
    )
  }

  parts.push('', '请直接输出符合上述规范的单文件 Vue 组件代码。')
  return parts.join('\n')
}

/** 按扩展名给出代码块语言，便于模型理解资料格式 */
function languageOf(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js',
    vue: 'vue', json: 'json', jsonc: 'json', md: 'md', markdown: 'md',
    css: 'css', scss: 'scss', less: 'less', html: 'html', htm: 'html',
    csv: 'csv', xml: 'xml', yaml: 'yaml', yml: 'yaml', sql: 'sql',
    sh: 'bash', py: 'py', java: 'java', go: 'go', rs: 'rust', rb: 'ruby',
    php: 'php', svg: 'xml', toml: 'toml', ini: 'ini',
  }
  return map[ext] ?? 'text'
}

/** 修改当前组件：把当前代码一并发给模型，保证改动基于最新版本 */
export function buildModifyMessage(instruction: string, currentCode: string): string {
  const parts: string[] = []
  const code = currentCode.trim()
  if (code) {
    parts.push('当前组件代码如下：', '```vue', code, '```', '')
  }
  parts.push(
    `请在此基础上修改：${instruction.trim()}`,
    '',
    '要求：保持既有功能与代码风格，输出修改后的完整单文件 Vue 组件代码（完整代码，不要只给片段或 diff）。',
  )
  return parts.join('\n')
}
