/**
 * 编译管线自检（Node 环境）
 *
 * 用 vue3-sfc-loader 的 Node 构建 + @vue/server-renderer 验证：
 *  1. 内置示例组件能被编译并渲染；
 *  2. <script setup lang="ts">、props、computed、scoped 样式都能正常工作；
 *  3. 不支持的第三方 import 会给出可读的错误提示；
 *  4. 接入文档能从代码里正确提取 props / emits / slots / expose / 依赖。
 *
 * 运行：pnpm verify:sfc
 */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import * as Vue from 'vue'
import { loadModule } from 'vue3-sfc-loader'
import { renderToString } from '@vue/server-renderer'
import { analyzeComponent, buildUsageExample } from '../src/services/componentDoc.ts'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')

const vueModule = Object.assign(Object.create(null), Vue, { default: Vue })
const collectedStyles = []

function createOptions(entryName, source) {
  return {
    moduleCache: Object.assign(Object.create(null), { vue: vueModule }),
    getFile: async (path) => {
      if (path === entryName) return source
      throw new Error(`不支持的外部依赖：${path}`)
    },
    addStyle: (style) => collectedStyles.push(style),
    log: () => {},
    devMode: true,
  }
}

async function loadSfc(name, source) {
  const filename = `${name}.vue`
  return loadModule(filename, createOptions(filename, source))
}

async function render(component) {
  const app = Vue.createSSRApp(component)
  app.config.warnHandler = () => {}
  return renderToString(app)
}

const results = []
function check(name, condition, extra = '') {
  results.push({ name, pass: Boolean(condition), extra })
  const icon = condition ? 'PASS' : 'FAIL'
  console.log(`[${icon}] ${name}${extra ? ` — ${extra}` : ''}`)
}

// 1. 内置示例组件
const demoSource = await readFile(resolve(root, 'src/config/demoComponent.ts'), 'utf8')
const demoCode = demoSource.slice(demoSource.indexOf('`') + 1, demoSource.lastIndexOf('`'))
const demoComponent = await loadSfc('Demo', demoCode)
const demoHtml = await render(demoComponent)
check('内置示例组件编译成功', demoCode.includes('<template>'))
check('内置示例组件渲染出内容', demoHtml.includes('今日任务'), demoHtml.slice(0, 60).replace(/\s+/g, ' '))
check('内置示例组件渲染了任务项', demoHtml.includes('设计组件库的暗色主题变量'))
check('scoped 样式被收集', collectedStyles.some((style) => style.includes('.task-board')))

// 1.1 内置案例：电表监控（数据孪生大屏 + 配套数据源卡片）
const meterSource = await readFile(resolve(root, 'src/config/demoMeter.ts'), 'utf8')
/** 按模板字符串语义切出 `export const X = \`...\`` 的内容（跳过转义字符） */
function extractExportedSfc(text) {
  const parts = []
  const pattern = /export const ([A-Z_]+) = `/g
  let match
  while ((match = pattern.exec(text)) !== null) {
    const start = match.index + match[0].length
    let index = start
    let end = -1
    while (index < text.length) {
      if (text[index] === '\\') {
        index += 2
        continue
      }
      if (text[index] === '`') {
        end = index
        break
      }
      index += 1
    }
    parts.push({
      name: match[1],
      code: text.slice(start, end).replace(/\\\$/g, '$').replace(/\\`/g, '`').replace(/\\\\n/g, '\\n'),
    })
    pattern.lastIndex = end + 1
  }
  return parts
}
const meterParts = extractExportedSfc(meterSource)
check('电表监控案例包含两个内置组件', meterParts.length === 2, `实际 ${meterParts.length} 个`)

const dashboardComponent = await loadSfc('MeterDashboard', meterParts[0].code)
const dashboardHtml = await render(dashboardComponent)
check(
  '电表监控大屏编译并渲染',
  dashboardHtml.includes('园区电表监控中心') && dashboardHtml.includes('孪生体'),
  dashboardHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50),
)
check(
  '电表监控大屏内置了离线台账',
  dashboardHtml.includes('1#车间总表') && dashboardHtml.includes('实时总功率趋势'),
)
const dashboardDoc = analyzeComponent(meterParts[0].code, { name: '电表监控大屏', summary: '数据孪生大屏' })
check('电表监控大屏只依赖 vue', dashboardDoc.thirdPartyImports.length === 0)

const sourceComponent = await loadSfc('MeterSource', meterParts[1].code)
const sourceHtml = await render(sourceComponent)
check(
  '电表数据源卡片编译并渲染',
  sourceHtml.includes('电表数据模拟服务') && meterParts[1].code.includes("'/api/health'"),
)
check('电表数据源卡片会调后端模拟服务', meterParts[1].code.includes("'/stream'"))

// 2. TypeScript + props + computed
const tsSource = `<template>
  <div class="ts-demo">
    <span>{{ label }}</span>
    <em>{{ doubled }}</em>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

const props = withDefaults(defineProps<{ title?: string }>(), { title: '默认标题' })
const count = ref<number>(2)
const label = computed<string>(() => props.title + ':' + count.value)
const doubled = computed<number>(() => count.value * 2)
</script>

<style scoped>
.ts-demo { color: red; }
</style>
`
const tsComponent = await loadSfc('TsDemo', tsSource)
const tsHtml = await render(tsComponent)
check('TypeScript 组件编译成功', tsHtml.includes('ts-demo'))
check('props / computed 正常求值', tsHtml.includes('默认标题:2') && tsHtml.includes('>4<'), tsHtml.replace(/\s+/g, ' '))

// 3. 第三方依赖应报错
let thirdPartyError = ''
try {
  await loadSfc('Bad', `<template><div>hi</div></template>
<script setup>
import { ElButton } from 'element-plus'
console.log(ElButton)
</script>`)
} catch (error) {
  thirdPartyError = error instanceof Error ? error.message : String(error)
}
check('第三方依赖被拒绝并给出提示', thirdPartyError.includes('element-plus'), thirdPartyError.split('\n')[0])

// 4. 接入文档：从代码里提取对外契约
const docSource = `<template>
  <div class="card">
    <h1>{{ title }}</h1>
    <slot name="footer" :year="2025"></slot>
    <slot></slot>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

interface Props {
  /** 卡片标题 */
  title?: string
  /** 深色模式 */
  dark?: boolean
  initial: number
  tags: string[]
}

const props = withDefaults(defineProps<Props>(), { title: '默认标题', dark: false })
const emit = defineEmits<{ (e: 'select', id: number): void; (e: 'close'): void }>()
const count = ref<number>(props.initial)
const label = computed(() => props.title + count.value)
function reset(): void {
  count.value = 0
}
defineExpose({ reset, count })
</script>

<style scoped>
.card { color: red; }
</style>
`
const doc = analyzeComponent(docSource, {
  name: '用户卡片组件',
  summary: '展示用户信息',
  apis: [{ method: 'GET', url: 'http://127.0.0.1:5398/v1/demo' }],
})
const propNames = doc.props.map((item) => item.name).join(',')
check('接入文档：保留中文展示名', doc.displayName === '用户卡片组件')
check(
  '接入文档：中文名退化成合法标识符与文件名',
  doc.componentName === 'MyComponent' && doc.fileName === 'MyComponent.vue',
  `${doc.componentName} / ${doc.fileName}`,
)
check('接入文档：识别脚本语言与 scoped 样式', doc.lang === 'TypeScript' && doc.scoped)
check('接入文档：解析出全部 props', propNames === 'title,dark,initial,tags', propNames)
check(
  '接入文档：props 带类型 / 可选 / 默认值',
  doc.props[0].type === 'string' &&
    doc.props[0].optional &&
    doc.props[0].defaultValue === "'默认标题'" &&
    doc.props[0].description === '卡片标题',
)
check('接入文档：必填 props 不带问号', doc.props[2].name === 'initial' && !doc.props[2].optional && doc.props[2].defaultValue === undefined)
check(
  '接入文档：解析出 events 与载荷',
  doc.emits.length === 2 && doc.emits[0].name === 'select' && doc.emits[0].payload === 'id: number' && doc.emits[1].name === 'close',
)
check(
  '接入文档：解析出插槽与作用域参数',
  doc.slots.length === 2 && doc.slots[0].name === 'footer' && doc.slots[0].props === 'year: 2025' && doc.slots[1].name === 'default',
)
check('接入文档：解析出 defineExpose', doc.exposes.join(',') === 'reset,count', doc.exposes.join(','))
check('接入文档：带上了接口依赖', doc.apis.length === 1 && doc.apis[0].url.includes('/v1/demo'))
check('接入文档：没有误判第三方依赖', doc.thirdPartyImports.length === 0)
check(
  '接入文档 Markdown 含关键小节',
  ['## Props', '## Events', '## Slots', '## 接口依赖', '## 使用示例', '| `title` |'].every((part) =>
    doc.markdown.includes(part),
  ),
)
const usage = buildUsageExample(doc)
check(
  '使用示例包含组件标签 / 必填 props / 事件与插槽',
  usage.includes('<MyComponent') &&
    usage.includes(':initial="0"') &&
    usage.includes('@select="onSelect"') &&
    usage.includes('#footer'),
  usage.split('\n')[1],
)

// defineOptions({ name }) 优先作为标识符
const namedDoc = analyzeComponent(
  `<template><div /></template>
<script setup lang="ts">
defineOptions({ name: 'UserCard' })
defineProps<{ title: string }>()
</script>`,
  { name: '用户卡片', summary: '' },
)
check(
  '接入文档：优先采用 defineOptions 里的名字',
  namedDoc.componentName === 'UserCard' && namedDoc.fileName === 'UserCard.vue',
  namedDoc.componentName,
)

const failed = results.filter((item) => !item.pass)
console.log(`\n共 ${results.length} 项，失败 ${failed.length} 项`)
process.exit(failed.length ? 1 : 0)
