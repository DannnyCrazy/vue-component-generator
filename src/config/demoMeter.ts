/**
 * 内置案例：电表监控（数据孪生大屏）
 *
 * 与 scripts/meter-simulator.mjs 配套：组件优先连本机模拟服务（SSE 实时推送），
 * 连不上就自动降级为组件内建模拟，保证离线也能完整演示。
 */
export const METER_DASHBOARD_COMPONENT = `<template>
  <section class="tw-screen">
    <div class="tw-grid-bg" aria-hidden="true"></div>

    <header class="tw-head">
      <div class="head-side left">
        <span class="dot" :class="statusClass"></span>
        <span class="conn">{{ statusText }}</span>
        <span class="sep">|</span>
        <span class="mode">采样 {{ mode === 'live' ? '后端推送' : '本地模拟' }}</span>
      </div>
      <h1>园区电表监控中心 · 数据孪生大屏</h1>
      <div class="head-side right">
        <span class="mono">{{ clock }}</span>
        <span class="sep">|</span>
        <span class="mono">帧 {{ frameNo.toLocaleString() }}</span>
      </div>
    </header>

    <div class="kpi-row">
      <article v-for="card in kpis" :key="card.label" class="kpi">
        <div class="kpi-top">
          <span class="kpi-label">{{ card.label }}</span>
          <span class="kpi-unit">{{ card.unit }}</span>
        </div>
        <div class="kpi-value mono">
          {{ card.value }}<em v-if="card.delta !== undefined" :class="card.delta >= 0 ? 'up' : 'down'">
            {{ card.delta >= 0 ? '▲' : '▼' }}{{ Math.abs(card.delta).toFixed(1) }}%
          </em>
        </div>
        <svg class="kpi-spark" viewBox="0 0 100 26" preserveAspectRatio="none">
          <polyline :points="sparkPoints" fill="none" :stroke="card.color" stroke-width="1.6" />
        </svg>
      </article>
    </div>

    <div class="tw-body">
      <section class="panel col-left">
        <header class="panel-head"><span class="corner"></span><h2>孪生体 · 分区负荷</h2></header>
        <div class="twin">
          <div class="twin-axis mono"><span>{{ twinMax }}</span><span>{{ Math.round(twinMax / 2) }}</span><span>0</span></div>
          <div class="twin-floors">
            <div
              v-for="floor in groups"
              :key="floor.group"
              class="floor"
              :title="floor.group + '：' + floor.power.toFixed(1) + ' kW'"
            >
              <span class="floor-load mono">{{ floor.rate }}%</span>
              <div class="floor-bar">
                <div class="floor-fill" :style="{ height: floor.height + '%', background: floor.color }"></div>
              </div>
              <span class="floor-group">{{ floor.group }}</span>
              <span class="floor-power mono">{{ floor.power.toFixed(0) }} kW</span>
            </div>
          </div>
        </div>
        <ul class="chip-list">
          <li v-for="item in typeStats" :key="item.type">
            <span class="chip-dot" :style="{ background: item.color }"></span>
            <span class="chip-name">{{ item.type }}</span>
            <span class="chip-value mono">{{ item.power.toFixed(1) }} kW</span>
            <span class="chip-share mono">{{ item.share }}%</span>
          </li>
        </ul>
      </section>

      <section class="panel col-main">
        <header class="panel-head">
          <span class="corner"></span>
          <h2>实时总功率趋势</h2>
          <span class="head-note mono">近 {{ points.length }} 点 · {{ intervalLabel }} 采样</span>
        </header>
        <div class="chart-wrap">
          <svg class="chart" viewBox="0 0 620 240" preserveAspectRatio="none">
            <defs>
              <linearGradient id="twFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#3fe0ff" stop-opacity="0.45" />
                <stop offset="100%" stop-color="#3fe0ff" stop-opacity="0" />
              </linearGradient>
              <linearGradient id="twLine" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stop-color="#2f9dff" />
                <stop offset="100%" stop-color="#5fffd2" />
              </linearGradient>
            </defs>
            <g>
              <line v-for="g in 4" :key="'g' + g" x1="0" :y1="(g - 1) * 80" x2="620" :y2="(g - 1) * 80" class="gridline" />
            </g>
            <path :d="areaPath" fill="url(#twFill)" />
            <polyline :points="linePoints" fill="none" stroke="url(#twLine)" stroke-width="2" stroke-linejoin="round" />
            <circle :cx="last.x" :cy="last.y" r="4" class="cursor" />
            <circle v-if="hover.geom" :cx="hover.geom.x" :cy="hover.geom.y" r="4.5" class="cursor hover" />
            <line v-if="hover.geom" :x1="hover.geom.x" y1="0" :x2="hover.geom.x" y2="226" class="hover-line" />
            <g class="axis mono">
              <line x1="0" y1="226" x2="620" y2="226" />
              <text x="2" y="238">{{ chartLabels[0] }}</text>
              <text x="300" y="238" text-anchor="middle">{{ chartLabels[1] }}</text>
              <text x="618" y="238" text-anchor="end">{{ chartLabels[2] }}</text>
            </g>
            <rect x="0" y="0" width="620" height="240" fill="transparent" @mousemove="onHover" @mouseleave="hover.index = -1" />
          </svg>
          <div v-if="hover.geom" class="chart-tip mono" :style="{ left: hover.geom.x / 6.2 + '%' }">
            <b>{{ hover.power.toFixed(1) }} kW</b>
            <span>{{ hover.label }}</span>
          </div>
          <dl class="chart-stats">
            <div><dt>峰值</dt><dd class="mono">{{ chartStats.max.toFixed(1) }} kW</dd></div>
            <div><dt>均值</dt><dd class="mono">{{ chartStats.avg.toFixed(1) }} kW</dd></div>
            <div><dt>谷值</dt><dd class="mono">{{ chartStats.min.toFixed(1) }} kW</dd></div>
            <div><dt>波动率</dt><dd class="mono">{{ chartStats.ripple }}%</dd></div>
          </dl>
        </div>
        <div class="health">
          <div class="health-item">
            <span class="hl">三相不平衡度</span>
            <div class="bar"><i :style="{ width: quality.unbalance + '%' }" :class="quality.unbalance > 4 ? 'warn' : ''"></i></div>
            <span class="hv mono">{{ quality.unbalance }}%</span>
          </div>
          <div class="health-item">
            <span class="hl">平均功率因数</span>
            <div class="bar"><i :style="{ width: quality.pf * 100 + '%' }" :class="quality.pf < 0.9 ? 'warn' : 'ok'"></i></div>
            <span class="hv mono">{{ quality.pf.toFixed(3) }}</span>
          </div>
          <div class="health-item">
            <span class="hl">电压合格率</span>
            <div class="bar"><i :style="{ width: quality.voltageOk + '%' }" class="ok"></i></div>
            <span class="hv mono">{{ quality.voltageOk }}%</span>
          </div>
        </div>
      </section>

      <section class="panel col-right">
        <header class="panel-head"><span class="corner"></span><h2>24 小时负荷分布</h2></header>
        <div class="hours">
          <div
            v-for="(bar, index) in hours"
            :key="index"
            class="hbar"
            :class="{ active: index === hourNow }"
            :title="bar.label + '：' + bar.value + ' kW'"
          >
            <i :style="{ height: bar.height + '%' }"></i>
            <span v-if="index % 4 === 0" class="hlabel mono">{{ index }}</span>
          </div>
        </div>

        <header class="panel-head second">
          <span class="corner"></span><h2>电表状态</h2>
          <span class="head-note mono">{{ meters.length }} 只 · {{ alarmCount }} 异常</span>
        </header>
        <ul class="meter-list">
          <li
            v-for="meter in meters"
            :key="meter.id"
            :class="['meter', meter.status, { selected: meter.id === selectedId }]"
            @click="selectedId = meter.id"
          >
            <div class="m-line">
              <span class="m-name">{{ meter.name }}</span>
              <span class="m-status">{{ statusLabel(meter) }}</span>
            </div>
            <div class="m-line">
              <span class="m-id mono">{{ meter.id }} · {{ meter.type }}</span>
              <span class="m-power mono">{{ meter.power.toFixed(1) }} kW</span>
            </div>
            <div class="m-bar"><i :style="{ width: Math.min(100, meter.loadRate) + '%' }"></i></div>
            <div class="m-line sub">
              <span class="mono">{{ meter.voltage.toFixed(0) }}V / {{ meter.current.toFixed(0) }}A</span>
              <span class="mono">PF {{ meter.pf.toFixed(2) }} · {{ meter.temperature.toFixed(0) }}℃</span>
            </div>
          </li>
        </ul>

        <header class="panel-head second">
          <span class="corner"></span><h2>告警与事件</h2>
        </header>
        <ul class="event-list">
          <li v-for="event in events" :key="event.id" :class="event.level">
            <span class="e-time mono">{{ event.time }}</span>
            <span class="e-text">{{ event.meter }} · {{ event.text }}</span>
          </li>
          <li v-if="!events.length" class="empty">暂无告警，设备运行正常</li>
        </ul>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'

/** 单只电表的一帧运行数据 */
interface Meter {
  id: string
  name: string
  type: string
  group: string
  ratedKw: number
  ratedCurrent: number
  power: number
  voltage: number
  current: number
  pf: number
  energy: number
  temperature: number
  loadRate: number
  status: 'normal' | 'heavy' | 'alarm'
  updatedAt: number
}

interface Frame {
  ts: number
  tick: number
  meters: Meter[]
}

interface TxEvent {
  id: string
  time: string
  level: 'info' | 'warn' | 'alarm'
  meter: string
  text: string
}

interface Point {
  label: string
  value: number
}

/** 后端模拟推送地址（scripts/meter-simulator.mjs 默认监听的端口） */
const LIVE_BASE = 'http://127.0.0.1:5278'

const MAX_POINTS = 60
const INTERVAL_MS = 1000

const TYPE_COLORS: Record<string, string> = {
  生产车间: '#3fe0ff',
  办公用电: '#7c9cff',
  暖通动力: '#5fffd2',
  动力设备: '#ffd166',
  新能源: '#8affc1',
  关键负荷: '#ff9f43',
  冷链设备: '#4dd0e1',
  热力动力: '#ff7a8a',
  后勤用电: '#b39ddb',
  照明负荷: '#90a4ae',
}

/** 离线降级用的电表台账：只描述设备属性，运行值由本地模拟推进 */
interface MeterProfile {
  id: string
  name: string
  type: string
  group: string
  ratedKw: number
  ratedVoltage: number
  pf: number
  energy: number
}

const FALLBACK_METERS: MeterProfile[] = [
  { id: 'MTR-001', name: '1#车间总表', type: '生产车间', group: 'A 区', ratedKw: 800, ratedVoltage: 400, pf: 0.93, energy: 12860 },
  { id: 'MTR-002', name: '2#车间总表', type: '生产车间', group: 'A 区', ratedKw: 620, ratedVoltage: 400, pf: 0.92, energy: 9412 },
  { id: 'MTR-003', name: '办公楼照明', type: '办公用电', group: 'B 区', ratedKw: 150, ratedVoltage: 230, pf: 0.97, energy: 2610 },
  { id: 'MTR-004', name: '中央空调机房', type: '暖通动力', group: 'B 区', ratedKw: 330, ratedVoltage: 400, pf: 0.89, energy: 7428 },
  { id: 'MTR-005', name: '空压站', type: '动力设备', group: 'C 区', ratedKw: 250, ratedVoltage: 400, pf: 0.86, energy: 5180 },
  { id: 'MTR-006', name: '充电桩群', type: '新能源', group: 'C 区', ratedKw: 220, ratedVoltage: 400, pf: 0.99, energy: 3320 },
]

/** 电表台账 → 运行态（本地模拟的起点） */
function fromProfile(profile: MeterProfile): Meter {
  const factor = profile.ratedVoltage > 300 ? Math.sqrt(3) : 1
  return {
    id: profile.id,
    name: profile.name,
    type: profile.type,
    group: profile.group,
    ratedKw: profile.ratedKw,
    ratedCurrent: Math.round((profile.ratedKw * 1000) / (profile.ratedVoltage * factor * Math.max(0.5, profile.pf)) * 10) / 10,
    power: 0,
    voltage: profile.ratedVoltage,
    current: 0,
    pf: profile.pf,
    energy: profile.energy,
    temperature: 30,
    loadRate: 0,
    status: 'normal',
    updatedAt: Date.now(),
  }
}

const status = ref<'connecting' | 'live' | 'local'>('connecting')
const frameNo = ref(0)
const meters = ref<Meter[]>([])
const points = ref<Point[]>([])
const events = ref<TxEvent[]>([])
const selectedId = ref('')
const clock = ref('')

// 先铺一屏台账数据，这样即使数据源还没连上，界面也不会是空的
meters.value = FALLBACK_METERS.map(fromProfile)

let abort: AbortController | null = null
let localTimer: number | null = null
let clockTimer: number | null = null
let disposed = false
const rnd = (min: number, max: number): number => min + Math.random() * (max - min)

const mode = computed<'live' | 'local'>(() => (status.value === 'live' ? 'live' : 'local'))
const statusText = computed(() =>
  status.value === 'live' ? '实时推送已连接' : status.value === 'connecting' ? '正在连接数据源…' : '模拟数据源（后端未启动）',
)
const statusClass = computed(() => (status.value === 'live' ? 'ok' : status.value === 'connecting' ? 'wait' : 'local'))

const totalPower = computed(() => meters.value.reduce((sum, m) => sum + m.power, 0))
const totalEnergy = computed(() => meters.value.reduce((sum, m) => sum + m.energy, 0))
const avgVoltage = computed(() =>
  meters.value.length ? meters.value.reduce((sum, m) => sum + m.voltage, 0) / meters.value.length : 0,
)
const totalCurrent = computed(() => meters.value.reduce((sum, m) => sum + m.current, 0))
const avgPf = computed(() =>
  meters.value.length ? meters.value.reduce((sum, m) => sum + m.pf, 0) / meters.value.length : 0,
)
const peakPower = computed(() => meters.value.reduce((max, m) => Math.max(max, m.power), 1))
const alarmCount = computed(() => meters.value.filter((m) => m.status !== 'normal').length)
const intervalLabel = computed(() => (status.value === 'live' ? '后端 1s' : '本地 1s'))

const trend = computed(() => {
  const list = points.value
  if (list.length < 6) return 0
  const tail = list.slice(-3).reduce((s, p) => s + p.value, 0) / 3
  const head = list.slice(-9, -6).reduce((s, p) => s + p.value, 0) / 3
  return head ? ((tail - head) / head) * 100 : 0
})

const kpis = computed(() => [
  { label: '总有功功率', unit: 'kW', value: totalPower.value.toFixed(1), delta: trend.value, color: '#3fe0ff' },
  { label: '平均电压', unit: 'V', value: avgVoltage.value.toFixed(1), color: '#5fffd2' },
  { label: '总电流', unit: 'A', value: totalCurrent.value.toFixed(0), color: '#ffd166' },
  { label: '累计用电量', unit: 'kWh', value: totalEnergy.value.toFixed(0), color: '#7c9cff' },
])

/** 迷你走势线：把 KPI 上方的 sparkline 统一画成总功率的形状，够用且不额外占空间 */
const sparkPoints = computed(() => {
  const values = points.value.map((p) => p.value)
  if (values.length < 2) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100
      const y = 24 - ((value - min) / span) * 20
      return x.toFixed(1) + ',' + y.toFixed(1)
    })
    .join(' ')
})

/* ---------- 主趋势图（620 × 240，底部 14px 留给时间轴） ---------- */

const chartScale = computed(() => {
  const values = points.value.map((p) => p.value)
  const max = values.length ? Math.max(...values) : 100
  const min = values.length ? Math.min(...values) : 0
  // 纵轴至少留出 80kW 视野，否则采样点少的时候曲线会被放大成贴着边框的直线
  const pad = Math.max(40, (max - min) * 0.25)
  const top = max + pad
  const bottom = Math.max(0, min - pad)
  const span = top - bottom || 1
  const step = points.value.length > 1 ? 620 / (points.value.length - 1) : 620
  return {
    top,
    bottom,
    span,
    step,
    toY: (value: number) => 226 - ((value - bottom) / span) * 214,
  }
})

const linePoints = computed(() =>
  points.value.map((point, index) => \`\${(index * chartScale.value.step).toFixed(1)},\${chartScale.value.toY(point.value).toFixed(1)}\`).join(' '),
)
const areaPath = computed(() => {
  if (points.value.length < 2) return ''
  const line = points.value
    .map((point, index) => \`\${(index * chartScale.value.step).toFixed(1)},\${chartScale.value.toY(point.value).toFixed(1)}\`)
    .join(' L ')
  const lastX = ((points.value.length - 1) * chartScale.value.step).toFixed(1)
  return 'M 0,226 L ' + line + ' L ' + lastX + ',226 Z'
})
const last = computed(() => {
  const index = points.value.length - 1
  const value = points.value[index]?.value ?? 0
  return { x: Math.max(0, index) * chartScale.value.step, y: chartScale.value.toY(value) }
})
const chartLabels = computed(() => {
  const list = points.value
  if (!list.length) return ['', '', '']
  return [list[0].label, list[Math.floor(list.length / 2)].label, list[list.length - 1].label]
})
const chartStats = computed(() => {
  const values = points.value.map((p) => p.value)
  if (!values.length) return { max: 0, avg: 0, min: 0, ripple: 0 }
  const max = Math.max(...values)
  const min = Math.min(...values)
  const avg = values.reduce((s, v) => s + v, 0) / values.length
  return { max, min, avg, ripple: avg ? Math.round(((max - min) / avg) * 1000) / 10 : 0 }
})
const hover = reactive<{ index: number; geom: { x: number; y: number } | null; power: number; label: string }>({
  index: -1,
  geom: null,
  power: 0,
  label: '',
})

function onHover(event: MouseEvent): void {
  const list = points.value
  if (!list.length) return
  const box = (event.currentTarget as SVGRectElement).getBoundingClientRect()
  const ratio = box.width ? Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) : 0
  const index = Math.round(ratio * (list.length - 1))
  const point = list[index]
  hover.index = index
  hover.power = point.value
  hover.label = point.label
  hover.geom = { x: index * chartScale.value.step, y: chartScale.value.toY(point.value) }
}

/* ---------- 分区 / 类型 / 时段 聚合 ---------- */

function buildStats(): { group: string; power: number; rate: number; height: number; color: string }[] {
  const map = new Map<string, { power: number; rated: number }>()
  for (const meter of meters.value) {
    const item = map.get(meter.group) ?? { power: 0, rated: 0 }
    item.power += meter.power
    item.rated += meter.ratedKw
    map.set(meter.group, item)
  }
  const rows = [...map.entries()].map(([group, item]) => ({
    group,
    power: item.power,
    rate: item.rated ? Math.round((item.power / item.rated) * 1000) / 10 : 0,
  }))
  const peak = Math.max(1, ...rows.map((row) => row.power))
  return rows
    .sort((a, b) => a.group.localeCompare(b.group))
    .map((row) => ({
      ...row,
      // 顶部留出约 16% 空间给负荷率标签，避免标签被柱体压住
      height: Math.max(5, Math.round((row.power / peak) * 84)),
      color: row.rate > 90 ? 'linear-gradient(180deg,#ff7a8a,#ff9f43)' : 'linear-gradient(180deg,#3fe0ff,#2f6bff)',
    }))
}

const groups = computed(buildStats)
const twinMax = computed(() => Math.max(1, ...groups.value.map((g) => Math.round(g.power))))

const typeStats = computed(() => {
  const map = new Map<string, number>()
  for (const meter of meters.value) map.set(meter.type, (map.get(meter.type) ?? 0) + meter.power)
  const total = totalPower.value || 1
  return [...map.entries()]
    .map(([type, power]) => ({ type, power, share: Math.round((power / total) * 1000) / 10, color: TYPE_COLORS[type] ?? '#3fe0ff' }))
    .sort((a, b) => b.power - a.power)
    .slice(0, 8)
})

const hourNow = ref(new Date().getHours())
/** 24 小时负荷分布：用当天真实曲线形状（与模拟服务同一套系数）预先算好 */
const hours = computed(() => {
  const rows: { label: string; value: number; height: number }[] = []
  for (let hour = 0; hour < 24; hour += 1) {
    const industrial =
      0.55 + 0.34 * Math.exp(-((hour - 10) ** 2) / 6) + 0.26 * Math.exp(-((hour - 15) ** 2) / 8) + 0.16 * Math.exp(-((hour - 20) ** 2) / 10) - 0.18 * Math.exp(-((hour - 3) ** 2) / 6)
    const office =
      0.34 + 0.42 * Math.exp(-((hour - 11) ** 2) / 8) + 0.36 * Math.exp(-((hour - 15) ** 2) / 7) - 0.22 * Math.exp(-((hour - 4) ** 2) / 8)
    const factor = Math.min(1, (industrial + office) / 2 / 1.42)
    rows.push({ label: hour + ':00', value: 0, height: Math.round(Math.max(0.22, factor) * 100) })
  }
  const max = Math.max(1, ...rows.map((row) => row.height))
  return rows.map((row) => ({ ...row, height: Math.round((row.height / max) * 100) }))
})

const quality = computed(() => {
  const list = meters.value
  if (!list.length) return { unbalance: 0, pf: 0, voltageOk: 100 }
  const unbalance = Math.min(6, list.reduce((sum, m) => sum + Math.abs(m.current - m.ratedCurrent * 0.6) / Math.max(1, m.ratedCurrent), 0) * 0.6)
  const voltageOk = Math.round((list.filter((m) => Math.abs(m.voltage - (m.voltage > 300 ? 400 : 230)) / (m.voltage > 300 ? 400 : 230) < 0.07).length / list.length) * 1000) / 10
  return { unbalance: Math.round(unbalance * 100) / 100, pf: avgPf.value, voltageOk }
})

function statusLabel(meter: Meter): string {
  if (meter.status === 'alarm') return '告警'
  if (meter.status === 'heavy') return '重载'
  return '正常'
}

/* ---------- 数据接入 ---------- */

function timeLabel(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
}

function pushPoint(value: number, ts: number): void {
  points.value.push({ label: timeLabel(ts), value })
  if (points.value.length > MAX_POINTS) points.value.splice(0, points.value.length - MAX_POINTS)
}

function addEvent(level: TxEvent['level'], meter: string, text: string): void {
  events.value.unshift({ id: 'E' + Date.now() + Math.random().toString(16).slice(2, 6), time: timeLabel(Date.now()), level, meter, text })
  if (events.value.length > 30) events.value.length = 30
}

function applyMeters(next: Meter[]): void {
  if (!selectedId.value && next.length) selectedId.value = next[0].id
  for (const meter of next) {
    const before = meters.value.find((item) => item.id === meter.id)
    if (before && before.status !== meter.status) {
      if (meter.status === 'alarm') addEvent('warn', meter.name, '状态转为告警，已定位并记录')
      else if (before.status === 'alarm') addEvent('info', meter.name, '告警恢复，参数回到正常区间')
      else if (meter.status === 'heavy') addEvent('info', meter.name, '负荷进入重载区间')
    }
  }
  meters.value = next
  frameNo.value += 1
  pushPoint(next.reduce((sum, m) => sum + m.power, 0), Date.now())
}

/** 本地降级模拟：与后端脚本同一套物理关系，只是跑在组件内 */
function tickLocal(): void {
  const now = new Date()
  const hour = now.getHours() + now.getMinutes() / 60
  const weekday = now.getDay()
  const industrial = 0.55 + 0.34 * Math.exp(-((hour - 10) ** 2) / 6) + 0.26 * Math.exp(-((hour - 15) ** 2) / 8) + 0.16 * Math.exp(-((hour - 20) ** 2) / 10) - 0.18 * Math.exp(-((hour - 3) ** 2) / 6)
  const office = 0.34 + 0.42 * Math.exp(-((hour - 11) ** 2) / 8) + 0.36 * Math.exp(-((hour - 15) ** 2) / 7) - 0.22 * Math.exp(-((hour - 4) ** 2) / 8)
  const curve = Math.max(0.22, Math.min(1, (industrial + office) / 2 / 1.42) * (weekday === 0 || weekday === 6 ? 0.62 : 1))

  if (!meters.value.length) meters.value = FALLBACK_METERS.map(fromProfile)

  const next = meters.value.map((meter, index) => {
    const profile = FALLBACK_METERS[index % FALLBACK_METERS.length]
    const target = meter.ratedKw * curve * (1 + rnd(-0.05, 0.05))
    const power = Math.max(0.5, meter.power * 0.55 + target * 0.45)
    const factor = meter.voltage > 300 ? Math.sqrt(3) : 1
    const pf = Math.min(0.999, Math.max(0.72, profile.pf + rnd(-0.009, 0.009)))
    const current = (power * 1000) / (meter.voltage * factor * pf)
    const loadRate = (current / meter.ratedCurrent) * 100
    const voltage = (meter.voltage > 300 ? 400 : 230) * (1 - rnd(0, 0.012))
    const temperature = Math.min(96, Math.max(22, meter.temperature * 0.92 + (26 + (loadRate / 100) * 46) * 0.08))
    const status: Meter['status'] = loadRate > 92 ? 'alarm' : loadRate > 84 ? 'heavy' : 'normal'
    return {
      ...meter,
      power: Math.round(power * 100) / 100,
      pf: Math.round(pf * 1000) / 1000,
      current: Math.round(current * 100) / 100,
      loadRate: Math.round(loadRate * 10) / 10,
      voltage: Math.round(voltage * 10) / 10,
      temperature: Math.round(temperature * 10) / 10,
      energy: Math.round((meter.energy + power / 3600) * 100) / 100,
      status,
      updatedAt: Date.now(),
    }
  })
  applyMeters(next)
}

/** 读取 SSE 流：手动解析 data: 行，任何异常都触发降级 */
async function connectLive(): Promise<void> {
  abort = new AbortController()
  const response = await fetch(LIVE_BASE + '/stream', { signal: abort.signal, cache: 'no-store' })
  if (!response.ok || !response.body) throw new Error('HTTP ' + response.status)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  status.value = 'live'
  if (!events.value.length) addEvent('info', '数据源', '已连接后端电表模拟推送服务')

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const chunks = buffer.split('\\n\\n')
    buffer = chunks.pop() ?? ''
    for (const chunk of chunks) {
      const line = chunk.split('\\n').find((item) => item.startsWith('data:'))
      if (!line) continue
      try {
        const frame = JSON.parse(line.slice(5).trim()) as Frame
        if (Array.isArray(frame.meters) && frame.meters.length) applyMeters(frame.meters)
      } catch {
        /* 半截 JSON 忽略，下一帧会补齐 */
      }
    }
  }
  if (!disposed) throw new Error('推送流已结束')
}

function startLocal(): void {
  if (localTimer !== null) return
  status.value = 'local'
  if (!meters.value.length) meters.value = FALLBACK_METERS.map(fromProfile)
  tickLocal()
  localTimer = window.setInterval(tickLocal, INTERVAL_MS)
  addEvent('info', '数据源', '后端服务不可用，已切换到组件内模拟数据')
}

onMounted(async () => {
  clockTimer = window.setInterval(() => {
    clock.value = timeLabel(Date.now())
    hourNow.value = new Date().getHours()
  }, 1000)
  clock.value = timeLabel(Date.now())

  try {
    await connectLive()
  } catch {
    if (disposed) return
    startLocal()
  }
})

onBeforeUnmount(() => {
  disposed = true
  abort?.abort()
  if (localTimer !== null) window.clearInterval(localTimer)
  if (clockTimer !== null) window.clearInterval(clockTimer)
})
</script>

<style scoped>
.tw-screen {
  position: relative;
  width: 100%;
  min-height: 100%;
  box-sizing: border-box;
  padding: 14px 16px 18px;
  background: radial-gradient(120% 90% at 50% 0%, #0b2038 0%, #061423 55%, #040d18 100%);
  color: #d7e9ff;
  font-family: 'HarmonyOS Sans SC', 'Microsoft YaHei', inherit;
  overflow: hidden;
}
.tw-grid-bg {
  position: absolute;
  inset: 0;
  background-image: linear-gradient(rgba(63, 224, 255, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(63, 224, 255, 0.05) 1px, transparent 1px);
  background-size: 34px 34px;
  mask-image: radial-gradient(120% 80% at 50% 20%, #000 30%, transparent 100%);
  pointer-events: none;
}
.tw-head {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(63, 224, 255, 0.18);
}
.tw-head h1 {
  margin: 0;
  flex: 1;
  text-align: center;
  font-size: clamp(15px, 2.4vw, 23px);
  font-weight: 700;
  letter-spacing: 3px;
  background: linear-gradient(180deg, #ffffff, #6fd8ff 70%, #2f9dff);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  text-shadow: 0 0 22px rgba(63, 224, 255, 0.28);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.head-side {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: #7fa8c9;
  white-space: nowrap;
}
.head-side .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ffb020;
  box-shadow: 0 0 0 0 rgba(63, 224, 255, 0.5);
}
.head-side .dot.ok {
  background: #2fe08a;
  animation: tw-pulse 1.8s infinite;
}
.head-side .dot.local {
  background: #ffb020;
}
.head-side .dot.wait {
  background: #4aa8ff;
  animation: tw-pulse 1.2s infinite;
}
@keyframes tw-pulse {
  0% { box-shadow: 0 0 0 0 rgba(47, 224, 138, 0.5); }
  100% { box-shadow: 0 0 0 8px rgba(47, 224, 138, 0); }
}
.sep {
  opacity: 0.35;
}
.mono {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-variant-numeric: tabular-nums;
}
.kpi-row {
  position: relative;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
  margin: 12px 0;
}
.kpi {
  position: relative;
  padding: 10px 12px 6px;
  border: 1px solid rgba(63, 224, 255, 0.2);
  border-radius: 4px;
  background: linear-gradient(160deg, rgba(18, 48, 78, 0.85), rgba(9, 25, 42, 0.7));
  box-shadow: inset 0 0 20px rgba(47, 157, 255, 0.12);
  clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 12px 100%, 0 calc(100% - 12px));
}
.kpi-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-size: 11.5px;
  color: #7fa8c9;
}
.kpi-unit {
  font-size: 10.5px;
  opacity: 0.8;
}
.kpi-value {
  margin-top: 4px;
  font-size: clamp(18px, 2.6vw, 26px);
  font-weight: 700;
  color: #eaf7ff;
  text-shadow: 0 0 16px rgba(63, 224, 255, 0.45);
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.kpi-value em {
  font-size: 11px;
  font-style: normal;
  font-weight: 600;
}
.kpi-value em.up {
  color: #ff9f43;
}
.kpi-value em.down {
  color: #2fe08a;
}
.kpi-spark {
  display: block;
  width: 100%;
  height: 26px;
  opacity: 0.85;
}
.tw-body {
  position: relative;
  display: grid;
  grid-template-columns: minmax(210px, 0.9fr) minmax(320px, 1.7fr) minmax(250px, 1.05fr);
  gap: 12px;
  align-items: stretch;
}
.panel {
  position: relative;
  min-width: 0;
  padding: 10px 12px 12px;
  border: 1px solid rgba(63, 224, 255, 0.16);
  background: linear-gradient(180deg, rgba(12, 34, 56, 0.72), rgba(6, 18, 31, 0.55));
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
}
.panel-head h2 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 1px;
  color: #cfe9ff;
}
.panel-head .corner {
  width: 4px;
  height: 13px;
  background: linear-gradient(180deg, #3fe0ff, #2f6bff);
  box-shadow: 0 0 10px rgba(63, 224, 255, 0.7);
}
.head-note {
  margin-left: auto;
  font-size: 10.5px;
  color: #6f97b8;
}
.panel-head.second {
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px dashed rgba(63, 224, 255, 0.18);
}
/* 孪生体 */
.twin {
  display: flex;
  gap: 6px;
  height: 178px;
}
.twin-axis {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding-bottom: 30px;
  font-size: 9.5px;
  color: #5c86a8;
}
.twin-floors {
  flex: 1;
  display: flex;
  align-items: stretch;
  gap: 8px;
}
.floor {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding-bottom: 4px;
}
.floor-bar {
  flex: 1;
  width: 100%;
  max-width: 46px;
  display: flex;
  align-items: flex-end;
  border-bottom: 1px solid rgba(63, 224, 255, 0.35);
  background: repeating-linear-gradient(0deg, rgba(63, 224, 255, 0.05) 0 1px, transparent 1px 26px);
}
.floor-fill {
  width: 100%;
  border-radius: 3px 3px 0 0;
  transition: height 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  box-shadow: 0 0 14px rgba(63, 224, 255, 0.4) inset;
  animation: tw-breathe 3.2s ease-in-out infinite;
}
@keyframes tw-breathe {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.22); }
}
.floor-group {
  font-size: 10px;
  color: #9ec4e0;
  white-space: nowrap;
}
.floor-power {
  font-size: 10.5px;
  color: #eaf7ff;
  white-space: nowrap;
}
.floor-load {
  font-size: 10px;
  color: #6fd8ff;
}
.chip-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
  max-height: 150px;
  overflow: auto;
}
.chip-list li {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11.5px;
  color: #b6d3e8;
}
.chip-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
.chip-name {
  flex: 1;
}
.chip-value {
  color: #eaf7ff;
}
.chip-share {
  width: 44px;
  text-align: right;
  color: #6fd8ff;
}
/* 主图 */
.chart-wrap {
  position: relative;
  flex: 1;
  min-height: 190px;
}
.chart {
  width: 100%;
  height: 100%;
  min-height: 190px;
  cursor: crosshair;
}
.gridline {
  stroke: rgba(63, 224, 255, 0.12);
  stroke-width: 1;
}
.cursor {
  fill: #5fffd2;
  filter: drop-shadow(0 0 6px rgba(95, 255, 210, 0.9));
}
.cursor.hover {
  fill: #ffd166;
}
.hover-line {
  stroke: rgba(255, 209, 102, 0.5);
  stroke-dasharray: 3 3;
}
.axis line {
  stroke: rgba(63, 224, 255, 0.3);
}
.axis text {
  fill: #6f97b8;
  font-size: 10px;
}
.chart-tip {
  position: absolute;
  top: 6px;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 8px;
  font-size: 10.5px;
  border: 1px solid rgba(255, 209, 102, 0.5);
  background: rgba(6, 18, 31, 0.9);
  color: #ffd166;
  pointer-events: none;
  white-space: nowrap;
}
.chart-tip span {
  color: #7fa8c9;
}
.chart-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  margin: 0;
}
.chart-stats div {
  padding: 5px 8px;
  border-left: 2px solid rgba(63, 224, 255, 0.5);
  background: rgba(63, 224, 255, 0.06);
}
.chart-stats dt {
  font-size: 10.5px;
  color: #7fa8c9;
}
.chart-stats dd {
  margin: 2px 0 0;
  font-size: 13px;
  color: #eaf7ff;
}
.health {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.health-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: #9ec4e0;
}
.health-item .hl {
  width: 84px;
  flex: none;
}
.bar {
  flex: 1;
  height: 7px;
  border-radius: 4px;
  background: rgba(63, 224, 255, 0.12);
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  border-radius: 4px;
  background: linear-gradient(90deg, #2f9dff, #3fe0ff);
  transition: width 0.5s ease;
}
.bar i.ok {
  background: linear-gradient(90deg, #1f9c72, #2fe08a);
}
.bar i.warn {
  background: linear-gradient(90deg, #ff7a8a, #ff9f43);
}
.hv {
  width: 58px;
  text-align: right;
  color: #eaf7ff;
}
/* 24 小时 */
.hours {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 96px;
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(63, 224, 255, 0.25);
}
.hbar {
  position: relative;
  flex: 1;
  height: 100%;
  display: flex;
  align-items: flex-end;
  cursor: default;
}
.hbar i {
  width: 100%;
  border-radius: 2px 2px 0 0;
  background: linear-gradient(180deg, rgba(63, 224, 255, 0.85), rgba(47, 107, 255, 0.35));
  transition: height 0.5s ease;
}
.hbar.active i {
  background: linear-gradient(180deg, #ffd166, #ff9f43);
  box-shadow: 0 0 10px rgba(255, 209, 102, 0.7);
}
.hlabel {
  position: absolute;
  bottom: -12px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 9px;
  color: #5c86a8;
}
/* 电表列表 */
.meter-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 240px;
  overflow: auto;
}
.meter {
  padding: 7px 9px;
  border: 1px solid rgba(63, 224, 255, 0.14);
  border-left: 3px solid #2fe08a;
  background: rgba(10, 30, 48, 0.55);
  cursor: pointer;
  transition: background 0.2s, transform 0.15s, border-color 0.2s;
}
.meter:hover {
  background: rgba(63, 224, 255, 0.1);
  transform: translateX(2px);
}
.meter.selected {
  border-color: rgba(63, 224, 255, 0.6);
  background: rgba(63, 224, 255, 0.14);
}
.meter.heavy {
  border-left-color: #ffd166;
}
.meter.alarm {
  border-left-color: #ff5f6d;
  animation: tw-alarm 1.6s infinite;
}
@keyframes tw-alarm {
  0%, 100% { background: rgba(255, 95, 109, 0.08); }
  50% { background: rgba(255, 95, 109, 0.22); }
}
.m-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11.5px;
}
.m-name {
  color: #dff0ff;
  font-weight: 600;
}
.m-status {
  font-size: 10px;
  color: #2fe08a;
}
.meter.heavy .m-status {
  color: #ffd166;
}
.meter.alarm .m-status {
  color: #ff5f6d;
}
.m-id,
.m-line.sub {
  font-size: 10.5px;
  color: #6f97b8;
}
.m-power {
  color: #6fd8ff;
}
.m-bar {
  height: 4px;
  margin: 4px 0;
  background: rgba(63, 224, 255, 0.12);
  overflow: hidden;
}
.m-bar i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #2f9dff, #3fe0ff);
  transition: width 0.55s ease;
}
.meter.heavy .m-bar i {
  background: linear-gradient(90deg, #ff9f43, #ffd166);
}
.meter.alarm .m-bar i {
  background: linear-gradient(90deg, #ff5f6d, #ff9f43);
}
/* 事件 */
.event-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
  max-height: 132px;
  overflow: auto;
  font-size: 11px;
}
.event-list li {
  display: flex;
  gap: 8px;
  padding: 5px 7px;
  background: rgba(63, 224, 255, 0.06);
  border-left: 2px solid #2f9dff;
  color: #9ec4e0;
}
.event-list li.warn {
  border-left-color: #ffd166;
  color: #ffe0a3;
}
.event-list li.alarm {
  border-left-color: #ff5f6d;
  color: #ffc2c8;
}
.e-time {
  color: #6f97b8;
}
.event-list .empty {
  border-left-color: transparent;
  background: transparent;
  color: #6f97b8;
  justify-content: center;
}
@media (max-width: 1080px) {
  .tw-body {
    grid-template-columns: 1fr;
  }
  .tw-head h1 {
    letter-spacing: 1px;
  }
  .head-side .mode {
    display: none;
  }
}
</style>
`

/**
 * 配套的「数据源状态」小卡片：用来演示组件如何调用后端模拟服务，
 * 也是被「接口」面板自动采集的请求（/api/health 与 /stream）。
 */
export const METER_SOURCE_COMPONENT = `<template>
  <section class="src-card">
    <header>
      <div>
        <h3>电表数据模拟服务</h3>
        <p class="endpoint mono">{{ base }}</p>
      </div>
      <span class="pill" :class="state">{{ stateText }}</span>
    </header>

    <ul class="facts">
      <li><span>推送帧数</span><b class="mono">{{ frames }}</b></li>
      <li><span>在线订阅</span><b class="mono">{{ info?.subscribers ?? 0 }}</b></li>
      <li><span>采样间隔</span><b class="mono">{{ info ? info.intervalMs + ' ms' : '—' }}</b></li>
      <li><span>电表数量</span><b class="mono">{{ info?.meterCount ?? 0 }}</b></li>
      <li><span>运行时长</span><b class="mono">{{ uptime }}</b></li>
      <li><span>历史点数</span><b class="mono">{{ info?.historyPoints ?? 0 }}</b></li>
    </ul>

    <div class="last" v-if="lastFrame">
      <span class="mono">{{ lastFrame.time }}</span>
      <span>最新一帧：{{ lastFrame.total.toFixed(1) }} kW · PF {{ lastFrame.avgPf.toFixed(3) }}</span>
    </div>

    <div class="live" :class="{ on: streaming }">
      <div v-for="(bar, index) in bars" :key="index" class="lb" :style="{ height: bar + '%' }"></div>
    </div>

    <p class="hint" v-if="state !== 'live'">未检测到后端服务，先运行 <code>node scripts/meter-simulator.mjs</code> 再点「重新连接」。</p>

    <button class="btn" type="button" @click="start">重新连接</button>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

interface Health {
  ok: boolean
  service: string
  uptimeMs: number
  tick: number
  intervalMs: number
  meterCount: number
  subscribers: number
  historyPoints: number
}

interface Frame {
  ts: number
  meters: { power: number; pf: number }[]
}

const base = 'http://127.0.0.1:5278'
const state = ref<'connecting' | 'live' | 'offline'>('connecting')
const info = ref<Health | null>(null)
const frames = ref(0)
const bars = ref<number[]>(Array.from({ length: 32 }, () => 8))
const lastFrame = ref<{ time: string; total: number; avgPf: number } | null>(null)

let abort: AbortController | null = null
let disposed = false

const stateText = computed(() => (state.value === 'live' ? '已连接' : state.value === 'connecting' ? '连接中…' : '未连接'))
const streaming = computed(() => state.value === 'live')
const uptime = computed(() => {
  const ms = info.value?.uptimeMs ?? 0
  const s = Math.floor(ms / 1000)
  return Math.floor(s / 60) + ' 分 ' + String(s % 60).padStart(2, '0') + ' 秒'
})

function stamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
}

async function refreshHealth(): Promise<void> {
  const response = await fetch(base + '/api/health', { cache: 'no-store' })
  if (!response.ok) throw new Error('HTTP ' + response.status)
  info.value = (await response.json()) as Health
}

async function start(): Promise<void> {
  abort?.abort()
  abort = new AbortController()
  state.value = 'connecting'
  frames.value = 0
  try {
    await refreshHealth()
    const response = await fetch(base + '/stream', { signal: abort.signal, cache: 'no-store' })
    if (!response.ok || !response.body) throw new Error('HTTP ' + response.status)
    state.value = 'live'
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const chunks = buffer.split('\\n\\n')
      buffer = chunks.pop() ?? ''
      for (const chunk of chunks) {
        const line = chunk.split('\\n').find((item) => item.startsWith('data:'))
        if (!line) continue
        try {
          const frame = JSON.parse(line.slice(5).trim()) as Frame
          const total = frame.meters.reduce((sum, m) => sum + m.power, 0)
          const avgPf = frame.meters.reduce((sum, m) => sum + m.pf, 0) / frame.meters.length
          frames.value += 1
          lastFrame.value = { time: stamp(), total, avgPf }
          bars.value = [...bars.value.slice(1), Math.max(6, Math.min(100, (total / 1200) * 100))]
        } catch {
          /* 忽略半截 JSON */
        }
      }
      if (frames.value % 5 === 0) void refreshHealth().catch(() => undefined)
    }
    if (!disposed) throw new Error('流已结束')
  } catch {
    if (disposed) return
    state.value = 'offline'
  }
}

onMounted(() => {
  void start()
})

onBeforeUnmount(() => {
  disposed = true
  abort?.abort()
})
</script>

<style scoped>
.src-card {
  width: 100%;
  box-sizing: border-box;
  padding: 18px;
  border-radius: 14px;
  border: 1px solid rgba(63, 224, 255, 0.2);
  background: linear-gradient(170deg, #0d2438, #061423 70%);
  color: #d7e9ff;
  font-family: 'HarmonyOS Sans SC', 'Microsoft YaHei', inherit;
}
header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
h3 {
  margin: 0;
  font-size: 16px;
}
.endpoint {
  margin: 4px 0 0;
  font-size: 11.5px;
  color: #6f97b8;
}
.mono {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-variant-numeric: tabular-nums;
}
.pill {
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11.5px;
  border: 1px solid currentColor;
  color: #ffb020;
}
.pill.live {
  color: #2fe08a;
}
.pill.offline {
  color: #ff7a8a;
}
.facts {
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 8px;
  margin: 14px 0;
  padding: 0;
}
.facts li {
  padding: 8px 10px;
  border-left: 2px solid rgba(63, 224, 255, 0.5);
  background: rgba(63, 224, 255, 0.06);
}
.facts span {
  display: block;
  font-size: 11px;
  color: #7fa8c9;
}
.facts b {
  font-size: 15px;
  color: #eaf7ff;
}
.last {
  display: flex;
  gap: 10px;
  font-size: 11.5px;
  color: #9ec4e0;
  margin-bottom: 10px;
}
.live {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 56px;
  padding-bottom: 4px;
  border-bottom: 1px solid rgba(63, 224, 255, 0.2);
}
.lb {
  flex: 1;
  border-radius: 2px 2px 0 0;
  background: linear-gradient(180deg, rgba(63, 224, 255, 0.9), rgba(47, 107, 255, 0.3));
  transition: height 0.4s ease;
  opacity: 0.55;
}
.live.on .lb {
  opacity: 1;
}
.hint {
  font-size: 11.5px;
  color: #ffc98a;
  margin: 10px 0 0;
}
.hint code {
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.08);
}
.btn {
  margin-top: 12px;
  padding: 8px 16px;
  border: 1px solid rgba(63, 224, 255, 0.5);
  border-radius: 8px;
  background: rgba(63, 224, 255, 0.12);
  color: #cfe9ff;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s, transform 0.15s;
}
.btn:hover {
  background: rgba(63, 224, 255, 0.24);
  transform: translateY(-1px);
}
</style>
`
