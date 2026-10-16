#!/usr/bin/env node
/**
 * 电表数据模拟推送服务（数据孪生大屏的数据源）
 *
 * 为「电表监控大屏」组件提供持续变化的实时数据：
 *   GET  /api/health          健康检查（运行时长、已推送帧数、在线订阅数）
 *   GET  /api/meters          当前一次快照（JSON）
 *   GET  /api/replay?limit=N  最近 N 个历史采样点（用于首屏画曲线）
 *   GET  /stream              SSE 实时推送，每帧一条 `data: {json}\n\n`
 *
 * 用法：
 *   node scripts/meter-simulator.mjs                 # 127.0.0.1:5278，1s 一帧
 *   node scripts/meter-simulator.mjs --port 6000 --interval 500 --meters 8
 *   node scripts/meter-simulator.mjs --persist .meter-state.json   # 电量累计跨重启保留
 *   node scripts/meter-simulator.mjs --peek          # 只打印一帧快照后退出（自检用）
 *
 * 依赖：仅 Node 内置模块（node:http / node:url / node:fs），Node.js >= 20。
 */
import { createServer } from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

/* ------------------------------ 参数解析 ------------------------------ */

function parseArgs(argv) {
  const options = {
    host: '127.0.0.1',
    port: 5278,
    interval: 1000,
    meters: 6,
    history: 240,
    persist: '',
    seed: 20240521,
    peek: false,
    quiet: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => {
      const value = argv[i + 1]
      if (value === undefined) throw new Error(`参数 ${arg} 缺少取值`)
      i += 1
      return value
    }
    switch (arg) {
      case '--host':
        options.host = next()
        break
      case '--port':
      case '-p':
        options.port = Number(next())
        break
      case '--interval':
        options.interval = Math.max(100, Number(next()))
        break
      case '--meters':
      case '-n':
        options.meters = Math.min(24, Math.max(1, Number(next())))
        break
      case '--history':
        options.history = Math.max(10, Number(next()))
        break
      case '--persist':
        options.persist = next()
        break
      case '--seed':
        options.seed = Number(next())
        break
      case '--peek':
        options.peek = true
        break
      case '--quiet':
        options.quiet = true
        break
      case '--help':
      case '-h':
        options.help = true
        break
      default:
        if (arg.startsWith('--')) throw new Error(`未知参数：${arg}`)
    }
  }
  if (!Number.isFinite(options.port) || options.port <= 0) throw new Error('--port 必须是正整数')
  if (!Number.isFinite(options.interval)) throw new Error('--interval 必须是数字（毫秒）')
  return options
}

/* ------------------------------ 运行参数 ------------------------------ */

const options = parseArgs(process.argv.slice(2))

if (options.help) {
  console.log(`电表数据模拟推送服务

  --host <ip>        监听地址，默认 127.0.0.1
  --port <n>         监听端口，默认 5278
  --interval <ms>    推送间隔，默认 1000
  --meters <n>       电表数量（1-24），默认 6
  --history <n>      内存保留的历史采样点，默认 240
  --persist <file>   把累计电量与历史写入文件（跨重启保留）
  --seed <n>         随机种子，默认 20240521
  --peek             只输出一帧快照后退出（自检用）
  --quiet            不打印每帧日志
`)
  process.exit(0)
}

/* ------------------------------ 随机与工具 ------------------------------ */

/** 可复现的伪随机数（mulberry32），保证同一 seed 下数据形态一致 */
function createRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const round = (value, digits = 2) => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** Box-Muller：把均匀随机变成近似正态，用于功率抖动 */
function gaussian(random) {
  const u = Math.max(random(), 1e-9)
  const v = random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/* ------------------------------ 电表台账 ------------------------------ */

const TEMPLATES = [
  { name: '1#车间总表', type: '生产车间', group: 'A 区', base: 720, pf: 0.93, ct: 600, voltage: 400 },
  { name: '2#车间总表', type: '生产车间', group: 'A 区', base: 560, pf: 0.92, ct: 500, voltage: 400 },
  { name: '办公楼照明', type: '办公用电', group: 'B 区', base: 132, pf: 0.97, ct: 200, voltage: 230 },
  { name: '中央空调机房', type: '暖通动力', group: 'B 区', base: 300, pf: 0.89, ct: 400, voltage: 400 },
  { name: '空压站', type: '动力设备', group: 'C 区', base: 240, pf: 0.86, ct: 300, voltage: 400 },
  { name: '充电桩群', type: '新能源', group: 'C 区', base: 210, pf: 0.99, ct: 250, voltage: 400 },
  { name: '数据中心 UPS', type: '关键负荷', group: 'D 区', base: 228, pf: 0.98, ct: 300, voltage: 400 },
  { name: '冷库机组', type: '冷链设备', group: 'D 区', base: 246, pf: 0.88, ct: 400, voltage: 400 },
  { name: '锅炉房', type: '热力动力', group: 'E 区', base: 196, pf: 0.9, ct: 300, voltage: 400 },
  { name: '水泵站', type: '动力设备', group: 'E 区', base: 152, pf: 0.91, ct: 200, voltage: 400 },
  { name: '食堂综合用电', type: '后勤用电', group: 'F 区', base: 112, pf: 0.95, ct: 160, voltage: 230 },
  { name: '室外照明', type: '照明负荷', group: 'F 区', base: 64, pf: 0.96, ct: 100, voltage: 230 },
]

/** 24 小时负荷曲线系数（工作日）：早高峰 + 午后高峰 + 夜间低谷，工作日峰值归一到 1 */
function loadCurve(hour, weekday) {
  const industrial =
    0.55 +
    0.34 * Math.exp(-((hour - 10) ** 2) / 6) +
    0.26 * Math.exp(-((hour - 15) ** 2) / 8) +
    0.16 * Math.exp(-((hour - 20) ** 2) / 10) -
    0.18 * Math.exp(-((hour - 3) ** 2) / 6)
  const office =
    0.34 +
    0.42 * Math.exp(-((hour - 11) ** 2) / 8) +
    0.36 * Math.exp(-((hour - 15) ** 2) / 7) -
    0.22 * Math.exp(-((hour - 4) ** 2) / 8)
  const blended = (industrial + office) / 2
  // 先用一个比典型峰值略高的参考值归一，保证曲线贴近 1 但不越界
  const normalized = Math.min(1, blended / 1.42)
  const weekend = weekday === 0 || weekday === 6 ? 0.62 : 1
  return Math.max(0.22, normalized * weekend)
}

function createMeters(count, seed) {
  const random = createRandom(seed)
  const meters = []
  for (let i = 0; i < count; i += 1) {
    const template = TEMPLATES[i % TEMPLATES.length]
    const scale = 0.92 + random() * 0.16
    // 额定容量略高于日峰值，因此负荷率常年落在 40%~90%，越限（>90%）才是真告警
    const capacity = template.base * scale * 1.18
    meters.push({
      id: `MTR-${String(i + 1).padStart(3, '0')}`,
      name: `${template.name}`,
      type: template.type,
      group: template.group,
      ratedKw: Math.round(capacity),
      ctRatio: template.ct,
      ratedVoltage: template.voltage,
      baseKw: capacity,
      pfTarget: template.pf,
      // 运行态
      fault: false,
      faultTicks: 0,
      current: 0,
      power: 0,
      voltage: template.voltage,
      pf: template.pf,
      energy: round(1200 + random() * 26000, 2),
      temperature: 28 + random() * 5,
      online: true,
      updatedAt: Date.now(),
    })
  }
  return meters
}

function ratedCurrentOf(meter) {
  const factor = meter.ratedVoltage > 300 ? Math.sqrt(3) : 1
  return (meter.ratedKw * 1000) / (meter.ratedVoltage * factor * Math.max(0.5, meter.pfTarget))
}

/* ------------------------------ 数据推进 ------------------------------ */

const state = {
  tick: 0,
  startedAt: Date.now(),
  lastFrameAt: Date.now(),
  events: [],
  history: [],
  peaks: [],
}

function stepMeters(meters, random, elapsedMs) {
  const now = new Date()
  const hour = now.getHours() + now.getMinutes() / 60
  const curve = loadCurve(hour, now.getDay())
  const dtHours = Math.max(1, elapsedMs) / 3600000

  for (const meter of meters) {
    // 故障：5% 概率进入，持续若干帧后自愈
    if (!meter.fault && random() < 0.004) {
      meter.fault = true
      meter.faultTicks = 6 + Math.floor(random() * 8)
      state.events.push({
        id: `EVT-${state.tick}-${meter.id}`,
        at: Date.now(),
        level: 'warn',
        meter: meter.name,
        text: '设备告警：运行参数越限，已自动记录',
      })
    }
    if (meter.fault) {
      meter.faultTicks -= 1
      if (meter.faultTicks <= 0) {
        meter.fault = false
        state.events.push({
          id: `EVT-${state.tick}-${meter.id}-r`,
          at: Date.now(),
          level: 'info',
          meter: meter.name,
          text: '告警恢复：运行参数回到正常区间',
        })
      }
    }

    const faultFactor = meter.fault ? 0.62 + random() * 0.2 : 1
    const jitter = 1 + gaussian(random) * 0.045
    const target = meter.baseKw * curve * jitter * faultFactor
    // 一阶惯性，避免数值瞬跳
    meter.power = round(Math.max(0.5, meter.power * 0.55 + target * 0.45), 2)

    meter.pf = round(
      Math.min(0.999, Math.max(0.72, meter.pfTarget - (meter.fault ? 0.14 : 0) + gaussian(random) * 0.008)),
      3,
    )

    const factor = meter.ratedVoltage > 300 ? Math.sqrt(3) : 1
    const rawCurrent = (meter.power * 1000) / (meter.ratedVoltage * factor * meter.pf)
    meter.current = round(Math.max(0.2, rawCurrent), 2)

    const drop = (meter.fault ? 0.06 : 0) + random() * 0.012
    meter.voltage = round(meter.ratedVoltage * (1 - drop), 1)

    const rated = ratedCurrentOf(meter)
    const loadRate = meter.current / rated
    meter.temperature = round(
      Math.min(96, Math.max(22, meter.temperature * 0.92 + (26 + loadRate * 46 + gaussian(random) * 1.2) * 0.08)),
      1,
    )

    meter.energy = round(meter.energy + (meter.power * dtHours) / 1000, 2)
    meter.online = true
    meter.updatedAt = Date.now()
    meter.status = meter.fault ? 'alarm' : loadRate > 0.9 ? 'heavy' : 'normal'
    meter.loadRate = round(loadRate * 100, 1)
    meter.ratedCurrent = round(rated, 1)
  }
}

function snapshot(meters) {
  return {
    ts: Date.now(),
    tick: state.tick,
    interval: options.interval,
    meters: meters.map((meter) => ({ ...meter })),
  }
}

function pushHistory(meters) {
  const point = {
    ts: Date.now(),
    total: round(meters.reduce((sum, m) => sum + m.power, 0), 2),
    avgPf: round(meters.reduce((sum, m) => sum + m.pf, 0) / meters.length, 3),
    avgU: round(meters.reduce((sum, m) => sum + m.voltage, 0) / meters.length, 1),
    energyTotal: round(meters.reduce((sum, m) => sum + m.energy, 0), 2),
  }
  state.history.push(point)
  if (state.history.length > options.history) state.history.splice(0, state.history.length - options.history)
  return point
}

/* ------------------------------ 持久化 ------------------------------ */

function persistPath() {
  return options.persist ? resolve(process.cwd(), options.persist) : ''
}

function restore(meters) {
  const file = persistPath()
  if (!file) return
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    for (const saved of data.meters ?? []) {
      const meter = meters.find((item) => item.id === saved.id)
      if (meter && Number.isFinite(saved.energy)) meter.energy = saved.energy
    }
    if (Array.isArray(data.history)) state.history = data.history.slice(-options.history)
    if (!options.quiet) console.log(`[meter-sim] 已恢复累计电量：${file}`)
  } catch {
    /* 首次运行没有状态文件，忽略 */
  }
}

let persistTimer = null
function schedulePersist(meters) {
  const file = persistPath()
  if (!file || persistTimer) return
  persistTimer = setTimeout(() => {
    persistTimer = null
    try {
      writeFileSync(
        file,
        JSON.stringify({ savedAt: Date.now(), meters: meters.map((m) => ({ id: m.id, energy: m.energy })), history: state.history }),
        'utf8',
      )
    } catch {
      /* 磁盘不可写时不影响推送 */
    }
  }, 5000)
}

/* ------------------------------ 启动 ------------------------------ */

const random = createRandom(options.seed)
const meters = createMeters(options.meters, options.seed)
restore(meters)

/**
 * 预热：连续推进若干帧但不推送。
 * 这样首个到来的订阅者看到的是一屏「早已在运行」的稳定数据，
 * 而不是功率为 0 的冷启动状态。
 */
function warmup(frames) {
  for (let i = 0; i < frames; i += 1) {
    state.lastFrameAt = Date.now()
    state.tick += 1
    stepMeters(meters, random, options.interval)
    pushHistory(meters)
  }
}
warmup(24)

if (options.peek) {
  pushHistory(meters)
  console.log(JSON.stringify(snapshot(meters), null, 2))
  process.exit(0)
}

const clients = new Set()

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  })
  res.end(body)
}

function handleStream(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    'access-control-allow-origin': '*',
  })
  res.write(': 电表数据模拟推送已连接\n\n')
  res.write(`data: ${JSON.stringify(snapshot(meters))}\n\n`)
  clients.add(res)
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n')
  }, 15000)
  const cleanup = () => {
    clearInterval(heartbeat)
    clients.delete(res)
  }
  req.on('close', cleanup)
  res.on('close', cleanup)
  res.on('error', cleanup)
}

function broadcast(frame) {
  const payload = `data: ${JSON.stringify(frame)}\n\n`
  for (const res of clients) {
    if (res.writableEnded) {
      clients.delete(res)
      continue
    }
    res.write(payload)
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const path = url.pathname.replace(/\/+$/, '') || '/'

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-max-age': '600',
    })
    res.end()
    return
  }

  if (path === '/api/health' || path === '/health') {
    sendJson(res, 200, {
      ok: true,
      service: 'meter-simulator',
      uptimeMs: Date.now() - state.startedAt,
      tick: state.tick,
      intervalMs: options.interval,
      meterCount: meters.length,
      subscribers: clients.size,
      historyPoints: state.history.length,
    })
    return
  }

  if (path === '/api/meters' || path === '/meters' || path === '/') {
    sendJson(res, 200, snapshot(meters))
    return
  }

  if (path === '/api/replay' || path === '/replay') {
    const limit = Math.min(options.history, Math.max(1, Number(url.searchParams.get('limit') ?? 60)))
    sendJson(res, 200, {
      ts: Date.now(),
      interval: options.interval,
      points: state.history.slice(-limit),
    })
    return
  }

  if (path === '/api/events' || path === '/events') {
    sendJson(res, 200, { ts: Date.now(), events: state.events.slice(-40).reverse() })
    return
  }

  if (path === '/stream' || path === '/api/stream' || path === '/events/stream') {
    handleStream(req, res)
    return
  }

  sendJson(res, 404, { error: { message: `未知路径：${path}` } })
})

/* ------------------------------ 主循环 ------------------------------ */

const timer = setInterval(() => {
  const now = Date.now()
  const elapsed = now - state.lastFrameAt
  state.lastFrameAt = now
  state.tick += 1
  stepMeters(meters, random, elapsed)
  const point = pushHistory(meters)
  broadcast(snapshot(meters))
  schedulePersist(meters)

  if (!options.quiet && state.tick % 10 === 0) {
    const total = meters.reduce((sum, m) => sum + m.power, 0)
    console.log(
      `[meter-sim] tick=${state.tick} 总功率=${total.toFixed(1)}kW 平均功率因数=${point.avgPf} 订阅者=${clients.size}`,
    )
  }
}, options.interval)

function shutdown(signal) {
  console.log(`\n[meter-sim] 收到 ${signal}，停止推送…`)
  clearInterval(timer)
  for (const res of clients) res.end()
  clients.clear()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 500).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

// 端口被占用时给出可读提示，并自动换到下一个端口（最多尝试 10 个）
let attempts = 0
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE' && attempts < 10) {
    attempts += 1
    const nextPort = options.port + attempts
    console.error(`[meter-sim] ${options.port} 已被占用，改用 ${nextPort}`)
    options.port = nextPort
    server.listen(options.port, options.host)
    return
  }
  console.error(`[meter-sim] 启动失败：${error.message}`)
  process.exit(1)
})

server.listen(options.port, options.host, () => {
  console.log(`
  电表数据模拟推送服务已启动
  ────────────────────────────────────────────────
  实时推送(SSE)  http://${options.host}:${options.port}/stream
  当前快照       http://${options.host}:${options.port}/api/meters
  历史采样       http://${options.host}:${options.port}/api/replay?limit=60
  健康检查       http://${options.host}:${options.port}/api/health
  ────────────────────────────────────────────────
  电表 ${meters.length} 只 · 每 ${options.interval}ms 一帧${options.persist ? ` · 状态文件 ${options.persist}` : ''}
`)
})
