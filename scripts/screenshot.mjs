/**
 * 界面截图脚本（用于文档与视觉回归）
 *
 * 启动开发服务器，用真实浏览器依次截取：欢迎页、预览（深色）、代码编辑器、
 * AI 平台设置、预览（浅色），输出到 docs/。
 * 为了让截图里能看到「组件管理 + 版本历史」的真实形态，会预置一个带 3 个版本的组件。
 *
 * 运行：node scripts/screenshot.mjs
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const PORT = 5397
const URL = `http://127.0.0.1:${PORT}/`
const OUT = resolve(root, 'docs')
mkdirSync(OUT, { recursive: true })

/** 截图用的示例组件（一个真实可渲染、并且带完整对外契约的表格） */
const TABLE_COMPONENT = `<template>
  <section class="table-card">
    <header class="head">
      <h2>{{ title }}</h2>
      <input v-model="keyword" placeholder="搜索姓名…" />
    </header>
    <ul class="rows">
      <li v-for="user in filtered" :key="user.id" @click="emit('select', user)">
        <span class="avatar">{{ user.name.slice(0, 1) }}</span>
        <span class="name">{{ user.name }}</span>
        <span class="mail">{{ user.email }}</span>
        <span class="state" :class="user.active ? 'on' : 'off'">{{ user.active ? '已启用' : '已停用' }}</span>
      </li>
    </ul>
    <p v-if="!filtered.length" class="empty">没有匹配的用户</p>
    <footer class="foot"><slot name="footer" :total="filtered.length">共 {{ filtered.length }} 位用户</slot></footer>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

export interface User {
  id: number
  name: string
  email: string
  active: boolean
}

interface Props {
  /** 卡片标题 */
  title?: string
  /** 关键字过滤的初始值 */
  keyword?: string
}

defineOptions({ name: 'UserTable' })

const props = withDefaults(defineProps<Props>(), { title: '用户列表', keyword: '' })
const emit = defineEmits<{ (e: 'select', user: User): void; (e: 'refresh'): void }>()

const keyword = ref<string>(props.keyword)
const users = ref<User[]>([
  { id: 1, name: '张伟', email: 'zhangwei@example.com', active: true },
  { id: 2, name: '李娜', email: 'lina@example.com', active: false },
  { id: 3, name: '王强', email: 'wangqiang@example.com', active: true },
])

const filtered = computed<User[]>(() =>
  users.value.filter((user) => user.name.includes(keyword.value.trim())),
)

/** 重新拉取数据（示例里是空实现） */
function reload(): void {
  emit('refresh')
}
defineExpose({ reload })
</script>

<style scoped>
.table-card {
  width: 100%;
  padding: 20px;
  border-radius: 16px;
  background: #101821;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #e6eef7;
  font-family: inherit;
}
.head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}
h2 {
  margin: 0;
  font-size: 17px;
  flex: 1;
}
.head input {
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.05);
  color: inherit;
  outline: none;
}
.rows {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rows li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
}
.avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, #42d392, #647eff);
  color: #06231a;
  font-weight: 700;
  font-size: 12px;
}
.name {
  width: 72px;
  font-size: 13.5px;
}
.mail {
  flex: 1;
  font-size: 12.5px;
  color: #8ea3b7;
}
.state {
  font-size: 11.5px;
  padding: 2px 9px;
  border-radius: 999px;
}
.state.on {
  color: #6ff0b4;
  background: rgba(66, 211, 146, 0.14);
}
.state.off {
  color: #ff9aa5;
  background: rgba(255, 95, 109, 0.14);
}
.empty {
  text-align: center;
  color: #6d8091;
  font-size: 13px;
  padding: 18px 0;
}
</style>
`

const PROJECT_SEED = () => {
  const now = Date.now()
  const makeVersion = (id, prompt, offsetMinutes, durationMs, attachmentName) => ({
    id,
    prompt,
    code: `${TABLE_COMPONENT}\n<!-- ${id} -->\n`,
    raw: '',
    reasoning: '',
    model: 'deepseek-chat',
    providerName: 'DeepSeek 官方',
    createdAt: now - offsetMinutes * 60_000,
    durationMs,
    ok: true,
    attachments: attachmentName ? [{ name: attachmentName, size: 2148 }] : [],
  })
  const short = (title) => '```vue\n<template>\n  <section class="table-card">\n    <!-- 省略 -->\n  </section>\n</template>\n```\n\n' + title
  const users = {
    id: 'cmp-users',
    name: '用户列表（带搜索）',
    prompt: '生成一个带搜索的用户列表组件，使用内置模拟数据',
    createdAt: now - 40 * 60_000,
    updatedAt: now - 2 * 60_000,
    versions: [
      makeVersion('ver-1', '生成一个带搜索的用户列表组件，使用内置模拟数据', 40, 18_300),
      makeVersion('ver-2', '加上头像与启用状态标签', 20, 12_600),
      makeVersion('ver-3', '搜索框再大一点，空数据时给提示', 2, 9_400, 'user-api.md'),
    ],
    activeVersionId: 'ver-3',
    messages: [
      { role: 'user', content: '生成一个带搜索的用户列表组件，使用内置模拟数据' },
      { role: 'assistant', content: short('已完成：包含搜索框与三行示例数据。') },
      { role: 'user', content: '加上头像与启用状态标签' },
      { role: 'assistant', content: short('已补充头像、状态标签与空数据提示。') },
    ],
  }
  const pomodoro = {
    id: 'cmp-pomodoro',
    name: '番茄钟倒计时',
    prompt: '生成一个番茄钟倒计时组件',
    createdAt: now - 120 * 60_000,
    updatedAt: now - 90 * 60_000,
    versions: [makeVersion('ver-p1', '生成一个番茄钟倒计时组件', 120, 26_700)],
    activeVersionId: 'ver-p1',
    messages: [{ role: 'user', content: '生成一个番茄钟倒计时组件' }, { role: 'assistant', content: short('已生成番茄钟。') }],
  }
  return { components: [users, pomodoro], activeId: 'cmp-users' }
}

/** 临时模式的草稿：只保留最新一版 */
const SCRATCH_SEED = () => ({
  name: '临时卡片',
  prompt: '做一张用完即走的临时卡片',
  code: `${TABLE_COMPONENT}\n<!-- scratch -->\n`,
  updatedAt: Date.now(),
})

const server = spawn(
  process.execPath,
  [resolve(root, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
  { cwd: root, stdio: 'ignore' },
)

async function waitForServer() {
  for (let i = 0; i < 150; i++) {
    try {
      const response = await fetch(URL)
      if (response.ok) return true
    } catch {
      /* 等待 */
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

const browser = await chromium.launch({ channel: 'msedge', headless: true }).catch(() => null)
try {
  if (!browser) throw new Error('未找到可用的 Edge/Chrome')
  if (!(await waitForServer())) throw new Error('开发服务器启动失败')

  const context = await browser.newContext({ viewport: { width: 1680, height: 1000 }, deviceScaleFactor: 1 })
  // 注意：addInitScript 只接受一个参数，多个种子要打包成一个对象传进去
  await context.addInitScript((seed) => {
    const now = Date.now()
    localStorage.setItem(
      'acs.settings.v1',
      JSON.stringify({
        profiles: [
          {
            id: 'p1',
            name: 'DeepSeek 官方',
            presetId: 'deepseek',
            flavor: 'openai',
            baseUrl: 'https://api.deepseek.com/v1',
            path: '/chat/completions',
            apiKey: 'sk-demo',
            model: 'deepseek-chat',
            models: ['deepseek-chat', 'deepseek-reasoner'],
            temperature: 0.4,
            maxTokens: 8192,
            extraHeaders: '',
            useProxy: false,
            createdAt: now,
            updatedAt: now,
          },
        ],
        activeProfileId: 'p1',
      }),
    )
    localStorage.setItem('acs.project.v1', JSON.stringify(seed.project))
    localStorage.setItem('acs.scratch.v1', JSON.stringify(seed.scratch))
    localStorage.setItem('acs.theme', 'dark')
  }, { project: PROJECT_SEED(), scratch: SCRATCH_SEED() })

  const page = await context.newPage()
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.app-header')
  await page.waitForSelector('[data-testid="workspace-project"]', { timeout: 20000 })
  await page.waitForTimeout(1200)

  // 项目模式：组件列表 + 当前组件预览
  await page.screenshot({ path: resolve(OUT, 'layout-project.png') })

  // 项目模式：对话标签页
  await page.locator('[data-testid="tab-chat"]').click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: resolve(OUT, 'layout-chat.png') })

  // 接入文档标签页
  await page.locator('[data-testid="tab-doc"]').click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: resolve(OUT, 'layout-doc.png') })

  // 组件代码
  await page.getByRole('button', { name: /组件代码/ }).click()
  await page.waitForTimeout(700)
  await page.screenshot({ path: resolve(OUT, 'code-editor.png') })

  // 设置弹窗
  await page.getByRole('button', { name: /实时预览/ }).click()
  await page.getByRole('button', { name: /设置/ }).first().click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: resolve(OUT, 'settings-platform.png') })
  await page.keyboard.press('Escape')
  await page.waitForSelector('.settings-modal', { state: 'detached' })

  // 临时模式（独立路由页面 #/scratch）：左栏换成组件信息
  await page.evaluate(() => {
    window.location.hash = '#/scratch'
  })
  await page.waitForSelector('[data-testid="workspace-scratch"]')
  await page.waitForTimeout(900)
  await page.screenshot({ path: resolve(OUT, 'layout-scratch.png') })

  // 浅色主题（回到项目模式）
  await page.evaluate(() => {
    window.location.hash = '#/project'
  })
  await page.waitForSelector('[data-testid="workspace-project"]')
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light'
  })
  await page.waitForTimeout(500)
  await page.screenshot({ path: resolve(OUT, 'layout-light.png') })

  await context.close()
  console.log('截图已输出到', OUT)
} finally {
  await browser?.close().catch(() => {})
  server.kill()
}
