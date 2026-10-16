/**
 * 生产构建冒烟测试
 *
 * 启动 `vite preview` 托管 dist/，用真实浏览器验证：
 *  1. 静态产物能正常加载（无 404 资源、无脚本错误）；
 *  2. 两种工作形态确实打成了两个独立 chunk：进 #/project 只加载项目 chunk，
 *     切到 #/scratch 才加载临时 chunk（互不依赖）；
 *  3. 编译内核（1.86 MB）按需下载，不在首屏。
 *
 * 运行：pnpm verify:build（需先执行 pnpm build）
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const PORT = 5396
const URL = `http://127.0.0.1:${PORT}/`

const results = []
function check(name, pass, extra = '') {
  results.push({ name, pass: Boolean(pass) })
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${extra ? ` — ${extra}` : ''}`)
}

if (!existsSync(resolve(root, 'dist/index.html'))) {
  console.error('未找到 dist/index.html，请先执行 pnpm build')
  process.exit(1)
}

/* ---------------- 1. 产物里应当有两个页面 chunk ---------------- */
const assets = await readdir(resolve(root, 'dist/assets'))
const projectChunks = assets.filter((name) => name.startsWith('workspace-project') && name.endsWith('.js'))
const scratchChunks = assets.filter((name) => name.startsWith('workspace-scratch') && name.endsWith('.js'))
check('产物包含项目模式的独立 chunk', projectChunks.length === 1, projectChunks.join(', '))
check('产物包含临时模式的独立 chunk', scratchChunks.length === 1, scratchChunks.join(', '))
check(
  '两个形态各自一个 chunk（互不合并）',
  projectChunks.length === 1 && scratchChunks.length === 1 && projectChunks[0] !== scratchChunks[0],
)

const server = spawn(
  process.execPath,
  [resolve(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
  { cwd: root, stdio: 'ignore' },
)

let browser
const errors = []
const requested = []

try {
  let ready = false
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(URL)
      if (response.ok) {
        ready = true
        break
      }
    } catch {
      /* 等待 */
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  check('生产构建可被静态服务托管', ready, URL)

  browser = await chromium.launch({ channel: 'msedge', headless: true }).catch(() => null)
  if (!browser) {
    for (const path of [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    ]) {
      if (existsSync(path)) {
        browser = await chromium.launch({ executablePath: path, headless: true })
        break
      }
    }
  }
  if (!browser) {
    console.log('[SKIP] 未找到可用的 Edge/Chrome')
    process.exit(0)
  }

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  page.on('response', (response) => requested.push(response.url()))
  page.on('requestfailed', (request) => errors.push(`requestfailed: ${request.url()}`))

  /* ---------------- 2. #/project ---------------- */
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.app-header', { timeout: 20000 })
  check('首屏外壳渲染成功', await page.getByText('AI 组件工坊').first().isVisible())

  const loaderBefore = requested.filter((url) => url.includes('vue3-sfc-loader')).length
  check('编译内核未在首屏加载（按需分包）', loaderBefore === 0, `首屏请求 ${requested.length} 个资源`)

  await page.waitForSelector('[data-testid="workspace-project"]', { timeout: 15000 })
  check('默认进入项目模式工作区（#/project）', page.url().includes('#/project'), page.url())
  const projectLoaded = requested.filter((url) => url.includes('workspace-project')).length
  const scratchLoadedOnProject = requested.filter((url) => url.includes('workspace-scratch')).length
  check('项目模式加载了自己的 chunk', projectLoaded > 0, `命中 ${projectLoaded} 次`)
  check('只访问项目模式时不会加载临时模式的 chunk', scratchLoadedOnProject === 0)

  /* ---------------- 3. 切到 #/scratch ---------------- */
  const beforeSwitch = requested.length
  await page.evaluate(() => {
    window.location.hash = '#/scratch'
  })
  await page.waitForSelector('[data-testid="workspace-scratch"]', { timeout: 15000 })
  const scratchLoaded = requested.slice(beforeSwitch).filter((url) => url.includes('workspace-scratch')).length
  check('访问 #/scratch 时才加载临时 chunk', scratchLoaded > 0, `切换后新增 ${scratchLoaded} 个相关请求`)
  check('临时模式工作区渲染成功', await page.getByText('组件信息').first().isVisible())
  check(
    '临时模式没有组件列表与对话标签页',
    (await page.getByText('组件管理').count()) === 0 && (await page.locator('[data-testid="tab-chat"]').count()) === 0,
  )
  check('顶部没有形态切换按钮（只能靠路由访问）', (await page.locator('[data-testid="mode-scratch"]').count()) === 0)

  /* ---------------- 4. 切回 #/project 并跑一次编译 ---------------- */
  await page.evaluate(() => {
    window.location.hash = '#/project'
  })
  await page.waitForSelector('[data-testid="workspace-project"]', { timeout: 15000 })
  check('可以切回项目模式', page.url().includes('#/project'), page.url())

  await page.getByRole('button', { name: /载入内置示例组件/ }).click()
  await page.waitForFunction(
    () => {
      const surface = document.querySelector('[data-testid="preview-surface"]')
      const target = surface?.shadowRoot?.querySelector('[data-acs-mount]') ?? surface
      return (target?.textContent ?? '').includes('今日任务')
    },
    undefined,
    { timeout: 25000 },
  )
  check('生产环境下组件编译并挂载成功', true)

  const loaderAfter = requested.filter((url) => url.includes('vue3-sfc-loader')).length
  check('首次编译时才下载编译内核', loaderAfter > 0, `命中 ${loaderAfter} 次`)

  await context.close()
  check('没有未预期的脚本错误或资源加载失败', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (error) {
  check(`执行过程未抛出异常（${error instanceof Error ? error.message : String(error)}）`, false)
} finally {
  await browser?.close().catch(() => {})
  server.kill()
}

const failed = results.filter((item) => !item.pass)
console.log(`\n共 ${results.length} 项，失败 ${failed.length} 项`)
process.exit(failed.length ? 1 : 0)
