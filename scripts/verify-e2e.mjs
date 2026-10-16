/**
 * 端到端自检（真实浏览器）
 *
 * 用 playwright-core 驱动本机已安装的 Edge/Chrome，配合一个本地模拟 AI 平台，
 * 覆盖两种工作形态：
 *
 *  A. 项目模式：保留每个组件的对话与历史版本
 *     - 左栏是组件列表，新建组件不会影响已有组件
 *     - 每个组件有自己的版本历史与对话，「修改当前组件」会把对话作为上下文一起发给模型
 *     - 切换组件时各自的数据都还在，刷新后依然在
 *  B. 临时模式：用完即走
 *     - 左栏换成当前组件的输入/输出信息，没有组件列表与对话
 *     - 「清空重来」立刻丢弃草稿；反复生成只保留最新一版
 *
 * 其余：Shadow DOM 挂载与真实交互、接口采集与重发测试、附件、代理转发、运行期错误。
 *
 * 运行：pnpm verify:e2e
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const APP_PORT = 5399
const STUB_PORT = 5398
const APP_URL = `http://127.0.0.1:${APP_PORT}/`

/* ------------------------------------------------------------------ */
/* 模拟 AI 平台：支持 SSE 流式输出 + CORS                              */
/* ------------------------------------------------------------------ */

const DEMO_API_URL = `http://127.0.0.1:${STUB_PORT}/v1/demo`

const GOOD_COMPONENT = `<template>
  <div class="gen-card">
    <h1>{{ title }}</h1>
    <p>这是一个由模拟平台返回、并在当前页面实时加载的组件。</p>
    <p class="api-line">{{ status }}</p>
    <button type="button" @click="onClick">点击了 {{ count }} 次</button>
    <footer class="foot"><slot name="footer">默认页脚</slot></footer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

interface Props {
  /** 卡片标题 */
  title?: string
  /** 初始计数 */
  initial?: number
}

defineOptions({ name: 'GenCard' })

const props = withDefaults(defineProps<Props>(), { title: 'AI 生成成功', initial: 0 })
const emit = defineEmits<{ (e: 'select', value: number): void }>()

const count = ref<number>(props.initial)
const status = ref<string>('正在请求接口…')

function onClick(): void {
  count.value += 1
  emit('select', count.value)
}

function reset(): void {
  count.value = 0
}
defineExpose({ reset })

onMounted(async () => {
  try {
    // 故意并发请求两次，用于验证「接口」面板按 method + url 合并统计
    const responses = await Promise.all([fetch('${DEMO_API_URL}'), fetch('${DEMO_API_URL}')])
    const data = (await responses[1].json()) as { message?: string }
    status.value = '接口返回：' + (data.message ?? '空')
  } catch (error) {
    status.value = '接口失败：' + String(error)
  }
})
</script>

<style scoped>
.gen-card { padding: 20px; border-radius: 14px; background: #101821; color: #e9f1f8; font-family: sans-serif; }
h1 { margin: 0 0 8px; font-size: 18px; color: #42d392; }
.api-line { color: #8ea3b7; font-size: 13px; }
.foot { margin-top: 12px; font-size: 12px; color: #8ea3b7; }
button { margin-top: 12px; padding: 8px 14px; border-radius: 9px; border: 0; background: #42d392; color: #06231a; cursor: pointer; }
</style>
`

/** 修改当前组件时平台返回的版本，标题不同，便于验证版本切换 */
const MODIFIED_COMPONENT = GOOD_COMPONENT.replace('AI 生成成功', 'AI 修改成功')

const BROKEN_COMPONENT = `<template>
  <div class="broke">{{ boom() }}</div>
</template>

<script setup lang="ts">
// 故意调用一个不存在的函数，验证运行期错误会被预览区捕获
</script>
`

/** 记录最近一次收到的请求，用于校验系统提示词、附件、对话上下文 */
const stubState = { lastSystemPrompt: '', lastUserMessage: '', lastMessageCount: 0, requestCount: 0 }

function sseBody(component) {
  const text = '```vue\n' + component + '\n```'
  const chunks = []
  const size = 90
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size))
  return chunks
}

const stub = createServer((req, res) => {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'POST, GET, OPTIONS',
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors)
    res.end()
    return
  }
  if (req.method === 'GET' && req.url.startsWith('/v1/models')) {
    res.writeHead(200, { ...cors, 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: 'stub-model' }, { id: 'stub-model-pro' }] }))
    return
  }
  if (req.method === 'GET' && req.url.startsWith('/v1/demo')) {
    res.writeHead(200, { ...cors, 'content-type': 'application/json' })
    res.end(JSON.stringify({ message: 'OK', items: [{ id: 1, name: '张三' }] }))
    return
  }
  if (req.method !== 'POST') {
    res.writeHead(404, cors)
    res.end('not found')
    return
  }

  let body = ''
  req.on('data', (chunk) => (body += chunk))
  req.on('end', async () => {
    let prompt = ''
    try {
      const parsed = JSON.parse(body)
      const messages = parsed.messages ?? []
      stubState.requestCount += 1
      stubState.lastMessageCount = messages.length
      stubState.lastSystemPrompt = messages.find((m) => m?.role === 'system')?.content ?? ''
      stubState.lastUserMessage = messages[messages.length - 1]?.content ?? ''
      prompt = JSON.stringify(messages[messages.length - 1] ?? {})
    } catch {
      /* ignore */
    }
    // 注意：修改请求里会带上当前组件代码，因此判定标记必须足够独特，
    // 否则组件源码里的普通字眼（例如「接口失败」）会误触发这些分支
    const isBroken = prompt.includes('这个需求会失败')
    const isModify = prompt.includes('当前组件代码如下')
    const component = isBroken ? BROKEN_COMPONENT : isModify ? MODIFIED_COMPONENT : GOOD_COMPONENT
    const chunks = sseBody(component)

    res.writeHead(200, {
      ...cors,
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    for (const piece of chunks) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`)
      await new Promise((r) => setTimeout(r, 20))
    }
    res.write('data: [DONE]\n\n')
    res.end()
  })
})

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

const results = []
function check(name, pass, extra = '') {
  results.push({ name, pass: Boolean(pass) })
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${extra ? ` — ${extra}` : ''}`)
}

async function waitForServer(url, timeoutMs = 60000) {
  const started = Date.now()
  for (;;) {
    try {
      const response = await fetch(url)
      if (response.ok) return true
    } catch {
      /* 还没起来 */
    }
    if (Date.now() - started > timeoutMs) return false
    await new Promise((r) => setTimeout(r, 400))
  }
}

async function waitForPreviewText(page, needle, timeout = 25000) {
  await page.waitForFunction(
    (text) => {
      const surface = document.querySelector('[data-testid="preview-surface"]')
      const target = surface?.shadowRoot?.querySelector('[data-acs-mount]') ?? surface
      return (target?.textContent ?? '').includes(text)
    },
    needle,
    { timeout },
  )
}

async function launchBrowser() {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ]
  try {
    return await chromium.launch({ channel: 'msedge', headless: true })
  } catch {
    /* 继续尝试其它方式 */
  }
  for (const path of candidates) {
    if (existsSync(path)) return chromium.launch({ executablePath: path, headless: true })
  }
  return null
}

function settingsSeed(useProxy) {
  const now = Date.now()
  return {
    profiles: [
      {
        id: 'stub-provider',
        name: '模拟平台',
        presetId: 'custom',
        flavor: 'openai',
        baseUrl: `http://127.0.0.1:${STUB_PORT}/v1`,
        path: '/chat/completions',
        apiKey: 'sk-stub',
        model: 'stub-model',
        models: ['stub-model'],
        temperature: 0.2,
        maxTokens: 4096,
        extraHeaders: '',
        useProxy,
        createdAt: now,
        updatedAt: now,
      },
    ],
    activeProfileId: 'stub-provider',
  }
}

const composerInput = '[data-testid="composer-input"]'

/** 顶部没有形态切换按钮，直接改 hash 走路由 */
async function gotoRoute(page, route) {
  // 先等当前路由页面挂载完成，避免与路由的首次导航相互覆盖
  await page.waitForFunction(() => Boolean(document.querySelector('[data-testid^="workspace-"]')), undefined, {
    timeout: 20000,
  })
  if (!page.url().includes(`#/${route}`)) {
    await page.evaluate((hash) => {
      window.location.hash = hash
    }, `#/${route}`)
  }
  await page.waitForSelector(`[data-testid="workspace-${route}"]`, { timeout: 20000 })
  await page.waitForTimeout(300)
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

let server
let browser
const pageErrors = []

try {
  await new Promise((r) => stub.listen(STUB_PORT, '127.0.0.1', r))

  server = spawn(
    process.execPath,
    [resolve(root, 'node_modules/vite/bin/vite.js'), '--port', String(APP_PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: root, stdio: 'ignore' },
  )

  if (!(await waitForServer(APP_URL))) throw new Error('Vite 开发服务器启动失败')
  check('开发服务器可访问', true, APP_URL)

  browser = await launchBrowser()
  if (!browser) {
    console.log('[SKIP] 未找到可用的 Edge/Chrome，跳过浏览器端验证')
    process.exit(0)
  }

  const context = await browser.newContext({ viewport: { width: 1720, height: 1000 } })
  await context.addInitScript((seed) => {
    localStorage.setItem('acs.settings.v1', JSON.stringify(seed))
    localStorage.setItem('acs.theme', 'dark')
  }, settingsSeed(false))

  const page = await context.newPage()
  page.on('pageerror', (error) => pageErrors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(`console: ${message.text()}`)
  })

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.app-header')
  // 路由页面是懒加载的，等首个工作区挂载完成再断言
  await page.waitForSelector('[data-testid="workspace-project"]', { timeout: 20000 })

  const preview = page.locator('[data-testid="preview-surface"]')
  const versionChips = page.locator('[data-testid="version-chip"]')
  const componentItems = page.locator('[data-testid="component-item"]')
  const infoPanel = page.locator('[data-testid="component-info"]')
  const chatTurns = page.locator('[data-testid="chat-turn"]')

  /* ================= A. 项目模式 ================= */

  check('页面外壳渲染成功', await page.getByText('AI 组件工坊').first().isVisible())
  check('平台配置被读取', (await page.locator('.provider-pill').innerText()).includes('模拟平台'))
  check(
    '默认进入项目模式路由（#/project）',
    page.url().includes('#/project') && (await page.locator('[data-testid="workspace-project"]').isVisible()),
    page.url(),
  )
  check(
    '顶部不再有项目/临时切换按钮',
    (await page.locator('[data-testid="mode-project"]').count()) === 0 &&
      (await page.locator('[data-testid="mode-scratch"]').count()) === 0,
  )
  check('项目模式左上显示组件列表', await page.getByText('组件', { exact: true }).first().isVisible())
  check('项目模式不显示组件信息面板', (await infoPanel.count()) === 0)
  check('左栏下方是当前组件的接口', await page.getByText('接口', { exact: true }).first().isVisible())
  check('右侧挂着历史记录栏', await page.locator('.history-rail').isVisible())
  check('中间栏底部是对话框', await page.locator(composerInput).isVisible())
  check(
    '历史记录挂在对话框右侧',
    await page.evaluate(() => {
      const composer = document.querySelector('.composer')?.getBoundingClientRect()
      const rail = document.querySelector('.history-rail')?.getBoundingClientRect()
      if (!composer || !rail) return false
      return rail.left >= composer.right - 1
    }),
  )
  check('项目模式有「对话」标签页', await page.locator('[data-testid="tab-chat"]').isVisible())
  check('初始没有组件', (await componentItems.count()) === 0)

  /* 历史栏可收起 */
  await page.locator('.history-rail button[title="收起历史记录"]').click()
  await page.waitForSelector('.rail-stub')
  const collapsedWidth = await page.evaluate(
    () => document.querySelector('.history-rail')?.getBoundingClientRect().width ?? 0,
  )
  check('历史记录可以收起成窄条', collapsedWidth > 0 && collapsedWidth < 60, `${Math.round(collapsedWidth)}px`)
  await page.locator('.rail-stub').click()
  await page.waitForSelector('.history-rail .empty-tip, .history-rail .version-list')
  const expandedWidth = await page.evaluate(
    () => document.querySelector('.history-rail')?.getBoundingClientRect().width ?? 0,
  )
  check('点击窄条可以再展开', expandedWidth > 200, `${Math.round(expandedWidth)}px`)

  /* 示例组件 */
  await page.getByRole('button', { name: /载入内置示例组件/ }).click()
  await waitForPreviewText(page, '今日任务', 20000)
  check('示例组件加入组件列表', (await componentItems.count()) === 1)
  check('示例组件有 1 个版本', (await versionChips.count()) === 1)
  const shadowInfo = await page.evaluate(() => {
    const surface = document.querySelector('[data-testid="preview-surface"]')
    const shadow = surface?.shadowRoot ?? null
    return {
      hasShadow: Boolean(shadow),
      mountedText: shadow?.querySelector('[data-acs-mount]')?.textContent?.slice(0, 40) ?? '',
      styleCount: shadow?.querySelectorAll('style[data-acs-style]').length ?? 0,
    }
  })
  check('示例组件挂载在 Shadow DOM 中', shadowInfo.hasShadow)
  check('示例组件渲染了内容', shadowInfo.mountedText.includes('今日任务'), shadowInfo.mountedText.replace(/\s+/g, ' '))
  check('组件样式注入到隔离作用域内', shadowInfo.styleCount > 0, `${shadowInfo.styleCount} 个 style`)

  await preview.locator('input[placeholder^="输入任务"]').fill('端到端测试任务')
  await preview.getByRole('button', { name: '添加' }).click()
  await waitForPreviewText(page, '端到端测试任务', 8000)
  check('示例组件交互可用（新增任务即时出现在页面上）', true)

  /* 偏好入口 */
  await page.locator('[data-testid="composer-prefs"]').click()
  await page.waitForSelector('.settings-modal')
  check('对话框上的偏好按钮能打开生成偏好设置', await page.getByText('输出形态（固定）').isVisible())
  await page.keyboard.press('Escape')
  await page.waitForSelector('.settings-modal', { state: 'detached' })

  /* 新建组件：项目模式下不会影响已有组件 */
  await page.locator('[data-testid="mode-create"]').click()
  const specContent = '# 用户接口约定\nGET /v1/users 返回 { items: [{ id, name }] }\n字段 name 表示昵称\n'
  await page.setInputFiles('[data-testid="composer-file"]', {
    name: 'api-spec.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(specContent, 'utf8'),
  })
  await page.waitForSelector('.composer .attach-chip')
  check('对话框可以添加参考文件', await page.locator('.composer .attach-chip', { hasText: 'api-spec.md' }).isVisible())

  await page.locator(composerInput).fill('生成一个带点击计数的卡片组件')
  await page.locator('[data-testid="send"]').click()
  await waitForPreviewText(page, 'AI 生成成功', 30000)
  check('AI 生成的组件已实时加载', true)
  check('项目模式新建后组件列表变成 2 个（旧组件保留）', (await componentItems.count()) === 2)
  check('新组件只有 1 个版本', (await versionChips.count()) === 1)
  check(
    '附件内容随需求一起发给了模型',
    stubState.lastUserMessage.includes('api-spec.md') && stubState.lastUserMessage.includes('GET /v1/users'),
  )
  check('新建时只发了系统提示词 + 本轮需求', stubState.lastMessageCount === 2, `${stubState.lastMessageCount} 条消息`)

  const systemPrompt = stubState.lastSystemPrompt
  check('请求确实携带了系统提示词', systemPrompt.length > 0, `${systemPrompt.length} 字符`)
  check(
    '系统提示词要求使用 TypeScript（script setup lang="ts"）',
    systemPrompt.includes('script setup lang="ts"') && systemPrompt.includes('禁止使用 any'),
  )
  check(
    '系统提示词要求只输出单个组件',
    systemPrompt.includes('单个独立组件') && systemPrompt.includes('不要模拟整站导航布局'),
  )
  check('系统提示词禁止第三方依赖', systemPrompt.includes('禁止引入任何第三方依赖'))

  await page.locator('[data-testid="tab-chat"]').click()
  await page.waitForSelector('[data-testid="chat-turn"]')
  check('对话标签页记录了这轮对话（2 条）', (await chatTurns.count()) === 2, `${await chatTurns.count()} 条`)

  /* 接入文档：从代码里提取契约 */
  await page.locator('[data-testid="tab-doc"]').click()
  await page.waitForSelector('[data-testid="doc-body"]')
  const propsText = await page.locator('[data-testid="doc-props"]').innerText()
  const emitsText = await page.locator('[data-testid="doc-emits"]').innerText()
  const slotsText = await page.locator('[data-testid="doc-slots"]').innerText()
  const usageText = await page.locator('[data-testid="doc-usage"]').innerText()
  check(
    '接入文档列出了 props（含类型与默认值）',
    propsText.includes('title') && propsText.includes('string') && propsText.includes('AI 生成成功') && propsText.includes('initial'),
    propsText.replace(/\s+/g, ' ').slice(0, 90),
  )
  check('接入文档列出了事件与载荷', emitsText.includes('select') && emitsText.includes('number'))
  check('接入文档列出了插槽', slotsText.includes('footer'))
  check('接入文档给出了使用示例（用 defineOptions 的名字）', usageText.includes('<GenCard') && usageText.includes(':initial="0"'))
  check('接入文档的示例带上了事件绑定', usageText.includes('@select="onSelect"'))
  await page.getByRole('button', { name: /看 Markdown/ }).click()
  const markdownText = await page.locator('[data-testid="doc-markdown"]').innerText()
  check(
    '可以查看 Markdown 源码',
    markdownText.includes('接入文档') && markdownText.includes('## Props') && markdownText.includes('```vue'),
  )
  await page.getByRole('button', { name: /看排版/ }).click()

  await page.getByRole('button', { name: /组件代码/ }).click()
  await page.waitForTimeout(500)
  const codeText = await page.evaluate(() => document.querySelector('.cm-content')?.textContent ?? '')
  check('代码面板显示了生成的 SFC', codeText.includes('title') && codeText.includes('script setup'))

  await page.getByRole('button', { name: /实时预览/ }).click()
  await preview.getByRole('button', { name: '点击了 0 次' }).click()
  await waitForPreviewText(page, '点击了 1 次', 8000)
  check('生成组件的响应式交互正常（0 → 1）', true)

  /* 接口采集与测试 */
  await waitForPreviewText(page, '接口返回：OK', 10000)
  await page.waitForSelector('.api-list li', { timeout: 10000 })
  const apiText = await page.locator('.api-list').innerText()
  check(
    '接口面板采集到当前组件发起的请求',
    apiText.includes('GET') && apiText.includes('/v1/demo') && apiText.includes('200'),
    apiText.replace(/\s+/g, ' '),
  )
  check('工作台自身的 AI 请求没有被误采集', !apiText.includes('/chat/completions'))
  check('同一接口的多次调用被合并统计', apiText.includes('×2'))

  await page.locator('.api-list li').first().click()
  await page.waitForSelector('.api-detail')
  await page.getByRole('button', { name: /发送测试/ }).click()
  await page.waitForSelector('.test-result', { timeout: 15000 })
  const testText = await page.locator('.test-result').innerText()
  check('接口测试可重发并返回结果', testText.includes('200') && testText.includes('OK'), testText.replace(/\s+/g, ' '))

  await page.locator('[data-testid="tab-doc"]').click()
  await page.waitForSelector('[data-testid="doc-apis"]')
  const docApiText = await page.locator('[data-testid="doc-apis"]').innerText()
  check(
    '接入文档记录了实测调用的接口',
    docApiText.includes('/v1/demo') && docApiText.includes('GET'),
    docApiText.replace(/\s+/g, ' '),
  )
  await page.getByRole('button', { name: /实时预览/ }).click()

  // 接口清空同样要确认
  await page.locator('[data-testid="api-clear"]').click()
  await page.waitForSelector('[data-testid="api-clear-confirm"]')
  check('接口清空也需要二次确认', (await page.locator('.api-list li').count()) > 0)
  await page.locator('[data-testid="api-clear-cancel"]').click()
  await page.waitForTimeout(200)
  check('取消后接口记录仍在', (await page.locator('.api-list li').count()) > 0)

  /* 修改当前组件：追加版本 + 带上对话上下文 */
  await page.locator(composerInput).fill('把标题文案改成「AI 修改成功」')
  await page.locator('[data-testid="send"]').click()
  await waitForPreviewText(page, 'AI 修改成功', 30000)
  check('修改后自动生成新版本', (await versionChips.count()) === 2)
  check(
    '修改请求带上了当前组件代码',
    stubState.lastUserMessage.includes('当前组件代码如下') && stubState.lastUserMessage.includes('点击了'),
  )
  check(
    '修改请求带上了该组件的对话上下文',
    stubState.lastMessageCount === 4,
    `${stubState.lastMessageCount} 条消息（系统 + 2 条对话 + 本轮）`,
  )
  const activeLabel = await page.locator('[data-testid="version-chip"].active .v-label').innerText()
  check('新版本成为当前版本', activeLabel === 'v2', activeLabel)

  await page.locator('[data-testid="tab-chat"]').click()
  await page.waitForTimeout(200)
  check('对话累积到 4 条', (await chatTurns.count()) === 4, `${await chatTurns.count()} 条`)

  /* 版本切换 */
  await versionChips.first().click()
  await waitForPreviewText(page, 'AI 生成成功', 12000)
  check('点击 v1 可回退到旧版本并重新加载', true)
  await versionChips.nth(1).click()
  await waitForPreviewText(page, 'AI 修改成功', 12000)
  check('点击 v2 可回到新版本', true)

  /* 组件之间各自独立 */
  await page.locator('[data-testid="component-item"]', { hasText: '内置示例组件' }).click()
  await waitForPreviewText(page, '今日任务', 15000)
  check('切到另一个组件会加载它自己的最新版本', true)
  check('另一个组件的历史也是自己的（1 个版本）', (await versionChips.count()) === 1)
  await page.locator('[data-testid="tab-chat"]').click()
  await page.waitForTimeout(200)
  check('另一个组件没有对话记录', (await chatTurns.count()) === 0)

  await page.locator('[data-testid="component-item"]', { hasText: '卡片组件' }).click()
  await waitForPreviewText(page, 'AI 修改成功', 15000)
  check('切回卡片组件仍保留 2 个版本', (await versionChips.count()) === 2)
  await page.locator('[data-testid="tab-chat"]').click()
  await page.waitForTimeout(200)
  check('切回卡片组件仍保留它的对话', (await chatTurns.count()) === 4)

  /* ================= B. 临时模式 ================= */

  await gotoRoute(page, 'scratch')
  check(
    '两种形态是两个路由页面，切换 URL 即可访问',
    page.url().includes('#/scratch') && (await page.locator('[data-testid="workspace-project"]').count()) === 0,
    page.url(),
  )
  check('临时模式左栏换成组件信息', await infoPanel.isVisible())
  check('临时模式没有组件列表', (await componentItems.count()) === 0)
  check('临时模式没有「对话」标签页', (await page.locator('[data-testid="tab-chat"]').count()) === 0)
  check('页面不再显示模式提示', (await page.locator('.mode-notice').count()) === 0)
  check('临时模式初始为空草稿', (await infoPanel.innerText()).includes('还没有组件'))

  await page.locator(composerInput).fill('做一张临时用的卡片')
  await page.locator('[data-testid="send"]').click()
  await waitForPreviewText(page, 'AI 生成成功', 30000)
  check('临时模式可以生成组件', true)
  const scratchBadge = page.locator('.info-panel .badge')
  check('临时模式组件信息显示 v1 / 1', (await scratchBadge.innerText()).replace(/\s+/g, '') === 'v1/1')
  check('临时模式不产生对话上下文', stubState.lastMessageCount === 2, `${stubState.lastMessageCount} 条消息`)

  // 「清空重来」需要二次确认：第一次点击只变确认态，草稿还在
  await page.locator('[data-testid="mode-create"]').click()
  await page.waitForSelector('[data-testid="mode-create-confirm"]')
  check('「清空重来」不会立刻清空，而是先要确认', !(await infoPanel.innerText()).includes('还没有组件'))
  check('清空确认态提供了取消', await page.locator('[data-testid="mode-create-cancel"]').isVisible())
  await page.locator('[data-testid="mode-create-cancel"]').click()
  await page.waitForTimeout(200)
  check('点取消后草稿保持不变', !(await infoPanel.innerText()).includes('还没有组件'))

  await page.locator('[data-testid="mode-create"]').click()
  await page.waitForSelector('[data-testid="mode-create-confirm"]')
  await page.locator('[data-testid="mode-create-confirm"]').click()
  await page.waitForTimeout(300)
  check('确认后才真正清空草稿', (await infoPanel.innerText()).includes('还没有组件'))
  check('清空后没有历史版本', (await versionChips.count()) === 0)

  await page.locator(composerInput).fill('再来一张临时卡片')
  await page.locator('[data-testid="send"]').click()
  await waitForPreviewText(page, 'AI 生成成功', 30000)
  check('清空后可以重新生成', true)
  check('临时模式只保留最新一版', (await scratchBadge.innerText()).replace(/\s+/g, '') === 'v1/1')
  check('临时模式历史里只有 1 个版本', (await versionChips.count()) === 1)

  /* 刷新后：项目模式的数据依然在，临时草稿也还在 */
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.app-header')
  await gotoRoute(page, 'project')
  check('切回项目模式路由（#/project）', page.url().includes('#/project') && (await componentItems.count()) === 2, page.url())

  /* ================= C. 代理转发 + 错误 ================= */

  await page.evaluate((seed) => localStorage.setItem('acs.settings.v1', JSON.stringify(seed)), settingsSeed(true))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('[data-testid="mode-create"]').click()
  await page.locator(composerInput).fill('再生成一个卡片，用于验证代理转发')
  await page.locator('[data-testid="send"]').click()
  await waitForPreviewText(page, 'AI 生成成功', 30000)
  check('开启本地代理后同样可以生成', true)

  await page.locator(composerInput).fill('这个需求会失败')
  await page.locator('[data-testid="send"]').click()
  await page.waitForSelector('text=组件未能加载', { timeout: 30000 })
  check('运行期错误被预览区捕获并展示', true)

  check(
    '页面无未预期的脚本错误',
    pageErrors.filter((item) => !item.includes('boom is not a function') && !item.includes('Cannot read')).length === 0,
    pageErrors.slice(0, 3).join(' | '),
  )

  await context.close()
} catch (error) {
  check(`执行过程未抛出异常（${error instanceof Error ? error.message : String(error)}）`, false)
} finally {
  await browser?.close().catch(() => {})
  server?.kill()
  stub.close()
}

const failed = results.filter((item) => !item.pass)
console.log(`\n共 ${results.length} 项，失败 ${failed.length} 项`)
process.exit(failed.length ? 1 : 0)
