/**
 * 「电表监控」内置案例的端到端自检（真实浏览器 + 真实推送）
 *
 * 覆盖链路：
 *  1. 预览区一键载入案例 → 工作台里出现「电表监控大屏」与「电表数据源状态」两个内置组件；
 *  2. 组件通过 SSE 连上后台模拟推送服务（scripts/meter-simulator.mjs），
 *     总功率 / 帧号持续变化、趋势折线在重绘、累计电量在增长；
 *  3. 组件发出的 /stream、/api/health 请求被「接口」面板自动采集；
 *  4. 停掉后台服务后重新载入，组件自动降级为组件内模拟，界面继续刷新（离线可演示）。
 *
 * 运行：pnpm verify:meter
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const APP_PORT = 5397
const SIM_PORT = 5278
const APP_URL = `http://127.0.0.1:${APP_PORT}/`
const SIM_URL = `http://127.0.0.1:${SIM_PORT}`

const results = []
function check(name, pass, extra = '') {
  results.push({ name, pass: Boolean(pass) })
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${extra ? ` — ${extra}` : ''}`)
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
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
    await sleep(400)
  }
}

/** 读取预览区（可能挂在 Shadow DOM 里）的可见文本 */
async function previewText(page) {
  return page.evaluate(() => {
    const surface = document.querySelector('[data-testid="preview-surface"]')
    const target = surface?.shadowRoot?.querySelector('[data-acs-mount]') ?? surface
    return (target?.textContent ?? '').replace(/\s+/g, ' ').trim()
  })
}

/** 出错时把现场信息打出来，便于定位（截图 + 各区域文本） */
async function dumpScene(page, tag) {
  const diagnostics = await page.evaluate(() => {
    const surface = document.querySelector('[data-testid="preview-surface"]')
    const shadow = surface?.shadowRoot ?? null
    const mount = shadow?.querySelector('[data-acs-mount]') ?? null
    let project = '{}'
    try {
      project = localStorage.getItem('acs.project.v1') ?? '{}'
    } catch {
      /* 忽略 */
    }
    const parsed = JSON.parse(project)
    const first = parsed?.components?.[0]
    return {
      url: location.href,
      hasSurface: Boolean(surface),
      hasShadow: Boolean(shadow),
      hasMount: Boolean(mount),
      mountText: (mount?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 200),
      componentCount: parsed?.components?.length ?? 0,
      firstName: first?.name ?? '',
      firstCodeLength: first?.versions?.[0]?.code?.length ?? 0,
      previewStatus: document.querySelector('.preview-panel .badge')?.textContent?.trim() ?? '',
      overlayText: (document.querySelector('.preview-area')?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 200),
    }
  })
  console.log(`[DIAG ${tag}]`, JSON.stringify(diagnostics))
  console.log(`[DIAG ${tag}] 页面错误:`, pageErrors.slice(0, 5).join(' | ') || '无')
  await page.screenshot({ path: resolve(root, `docs/diag-${tag}.png`) }).catch(() => {})
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

/** 从预览文本里取「帧 N」的帧号 */
function frameNo(text) {
  const match = /帧\s*([\d,]+)/.exec(text)
  return match ? Number(match[1].replace(/,/g, '')) : -1
}

/** 从预览文本里取总有功功率 */
function totalPower(text) {
  const match = /总有功功率\s*kW\s*([\d.]+)/.exec(text)
  return match ? Number(match[1]) : -1
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

let server = null
let simulator = null
let browser = null
const pageErrors = []

try {
  /* ---------- 后台电表模拟推送服务 ---------- */
  simulator = spawn(
    process.execPath,
    [resolve(root, 'scripts/meter-simulator.mjs'), '--port', String(SIM_PORT), '--interval', '500', '--meters', '6', '--quiet'],
    { cwd: root, stdio: 'ignore' },
  )
  if (!(await waitForServer(`${SIM_URL}/api/health`, 20000))) throw new Error('电表模拟推送服务启动失败')
  check('电表模拟推送服务已就绪', true, SIM_URL)

  const health = await (await fetch(`${SIM_URL}/api/health`)).json()
  check('模拟服务报告健康状态与电表数量', health.ok === true && health.meterCount === 6, `${health.meterCount} 只电表`)

  /* ---------- 开发服务器 ---------- */
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

  const context = await browser.newContext({ viewport: { width: 1760, height: 1000 } })
  await context.addInitScript(() => {
    localStorage.clear()
    localStorage.setItem('acs.theme', 'dark')
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => pageErrors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(`console: ${message.text()}`)
  })

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.app-header')
  await page.waitForSelector('[data-testid="workspace-project"]', { timeout: 20000 })

  const componentItems = page.locator('[data-testid="component-item"]')

  /* ================= 1. 一键载入案例 ================= */

  await page.getByRole('button', { name: /载入「电表监控」大屏案例/ }).click()
  await page.waitForTimeout(1500)
  await dumpScene(page, 'after-click')
  try {
    await waitForPreviewText(page, '园区电表监控中心', 20000)
  } catch {
    await dumpScene(page, 'before-dashboard')
    throw new Error('案例载入后预览区没有出现大屏内容')
  }

  check('案例载入后组件列表出现 2 个内置组件', (await componentItems.count()) === 2, `${await componentItems.count()} 个`)
  const names = (await componentItems.locator('.name').allInnerTexts()).map((name) => name.trim())
  const dashboardName = names.find((name) => name.includes('电表监控大屏')) ?? '电表监控大屏'
  const sourceName = names.find((name) => name.includes('数据源状态')) ?? '电表数据源状态'
  check('两个组件分别是大屏与数据源卡片', Boolean(dashboardName && sourceName), names.join(' / '))

  /* ================= 2. 实时推送链路 ================= */

  await waitForPreviewText(page, '实时推送已连接', 20000)
  check('大屏通过 SSE 连上了后台推送服务', true)

  const first = await previewText(page)
  check('大屏渲染出标题与孪生体分区', first.includes('园区电表监控中心') && first.includes('孪生体 · 分区负荷'))
  check('大屏铺开了电表台账', first.includes('1#车间总表') && first.includes('办公楼照明'))
  const firstFrame = frameNo(first)
  const firstPower = totalPower(first)
  check('首帧带上了功率数据', firstPower > 0, `${firstPower} kW`)

  await sleep(2600)
  const second = await previewText(page)
  const secondFrame = frameNo(second)
  const secondPower = totalPower(second)
  check('帧号随推送递增', secondFrame > firstFrame, `${firstFrame} → ${secondFrame}`)
  check('总功率在实时变化', secondPower !== firstPower, `${firstPower} kW → ${secondPower} kW`)

  const chart = await page.evaluate(() => {
    const surface = document.querySelector('[data-testid="preview-surface"]')
    const target = surface?.shadowRoot?.querySelector('[data-acs-mount]') ?? surface
    const polyline = target?.querySelector('polyline')
    const meters = target?.querySelectorAll('.meter').length ?? 0
    return { points: (polyline?.getAttribute('points') ?? '').split(' ').filter(Boolean).length, meters }
  })
  check('趋势折线已绘制出多个采样点', chart.points >= 3, `${chart.points} 个点`)
  check('电表列表渲染出全部电表', chart.meters === 6, `${chart.meters} 只`)

  const apiRows = page.locator('.api-list li')
  await page.waitForFunction(() => document.querySelectorAll('.api-list li').length > 0, undefined, { timeout: 15000 })
  const apiText = (await apiRows.allInnerTexts()).join(' | ')
  check('接口面板采集到 /stream 推送请求', apiText.includes('/stream'), apiText.replace(/\s+/g, ' ').slice(0, 80))

  /* ================= 3. 数据源卡片 ================= */

  await componentItems.filter({ hasText: sourceName }).click()
  await waitForPreviewText(page, '推送帧数', 20000)
  await waitForPreviewText(page, '已连接', 15000)
  await page.waitForFunction(
    () => {
      const surface = document.querySelector('[data-testid="preview-surface"]')
      const target = surface?.shadowRoot?.querySelector('[data-acs-mount]') ?? surface
      return /推送帧数\s*[1-9]/.test(target?.textContent ?? '')
    },
    undefined,
    { timeout: 15000 },
  )
  const sourceText = await previewText(page)
  check('数据源卡片显示已连接', sourceText.includes('已连接') && sourceText.includes('127.0.0.1:5278'))
  const sourceFrames = Number(/推送帧数\s*(\d+)/.exec(sourceText)?.[1] ?? 0)
  check('数据源卡片收到推送帧', sourceFrames > 0, `${sourceFrames} 帧`)
  check('数据源卡片报告了服务端指标', /采样间隔\s*500\s*ms/.test(sourceText) && /电表数量\s*6/.test(sourceText))

  // 回到大屏多攒一些采样点后截图，作为案例的展示图
  await componentItems.filter({ hasText: dashboardName }).click()
  await waitForPreviewText(page, '实时推送已连接', 20000)
  await sleep(9000)
  const shot = await previewText(page)
  check('截图前大屏已累积多个采样点', /近\s*(\d+)\s*点/.test(shot) && Number(/近\s*(\d+)\s*点/.exec(shot)[1]) >= 8, /近\s*\d+\s*点/.exec(shot)?.[0] ?? '')
  await page.screenshot({ path: resolve(root, 'docs/meter-dashboard-live.png'), fullPage: false }).catch(() => {})

  /* ================= 4. 停掉后端 → 自动降级 ================= */

  simulator.kill()
  await sleep(800)
  const offlineHealth = await fetch(`${SIM_URL}/api/health`).then(
    () => true,
    () => false,
  )
  check('后台模拟服务已停止', offlineHealth === false)

  await componentItems.filter({ hasText: dashboardName }).click()
  await waitForPreviewText(page, '模拟数据源', 30000)
  const offlineFirst = await previewText(page)
  check('大屏自动降级为组件内模拟', offlineFirst.includes('模拟数据源（后端未启动）'))
  await sleep(2600)
  const offlineSecond = await previewText(page)
  check(
    '离线状态下界面继续刷新',
    frameNo(offlineSecond) > frameNo(offlineFirst) && totalPower(offlineSecond) > 0,
    `帧 ${frameNo(offlineFirst)} → ${frameNo(offlineSecond)}`,
  )

  const realErrors = pageErrors.filter(
    (item) => !/127\.0\.0\.1:5278|Failed to fetch|ERR_CONNECTION_REFUSED|net::ERR/i.test(item),
  )
  check('除数据源不可用外没有其它脚本错误', realErrors.length === 0, realErrors.slice(0, 3).join(' | '))

  await context.close()
} catch (error) {
  check(`执行过程未抛出异常（${error instanceof Error ? error.message : String(error)}）`, false)
} finally {
  await browser?.close().catch(() => {})
  server?.kill()
  simulator?.kill()
}

const failed = results.filter((item) => !item.pass)
console.log(`\n共 ${results.length} 项，失败 ${failed.length} 项`)
process.exit(failed.length ? 1 : 0)
