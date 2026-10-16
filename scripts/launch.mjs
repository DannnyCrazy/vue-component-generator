/**
 * 启动器：由 start.cmd / build.cmd 调用（也可直接 `node scripts/launch.mjs`）。
 *
 * 之所以把提示信息放在这里而不是 .cmd 里：cmd.exe 对 UTF-8 批处理文件的解析不可靠，
 * 中文会出现乱码，因此 .cmd 只负责定位 Node.js，其余逻辑与文案都在 Node 里完成。
 *
 *   node scripts/launch.mjs            # 启动开发服务器
 *   node scripts/launch.mjs build      # 类型检查 + 生产构建 + 构建冒烟测试
 *   node scripts/launch.mjs preview    # 预览构建产物
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const mode = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : 'dev'
const extraArgs = process.argv.slice(mode === 'dev' && process.argv[2] === mode ? 3 : 2)

const viteBin = resolve(root, 'node_modules/vite/bin/vite.js')
const vueTscBin = resolve(root, 'node_modules/vue-tsc/bin/vue-tsc.js')

/** 依次尝试 pnpm（PATH）、DSH 内置 pnpm、npm 来安装依赖 */
function installDependencies() {
  const candidates = []
  if (spawnSync('pnpm', ['--version'], { shell: true, stdio: 'ignore' }).status === 0) {
    candidates.push({ label: 'pnpm', command: 'pnpm', args: ['install'] })
  }
  const bundledPnpm = resolve(dirname(process.execPath), '..', '..', 'pnpm', 'bin', 'pnpm.mjs')
  if (existsSync(bundledPnpm)) {
    candidates.push({
      label: 'bundled pnpm',
      command: process.execPath,
      args: [bundledPnpm, 'install'],
    })
  }
  if (spawnSync('npm', ['--version'], { shell: true, stdio: 'ignore' }).status === 0) {
    candidates.push({ label: 'npm', command: 'npm', args: ['install'] })
  }

  for (const candidate of candidates) {
    console.log(`  · 使用 ${candidate.label} 安装依赖…`)
    const result = spawnSync(candidate.command, candidate.args, {
      cwd: root,
      stdio: 'inherit',
      shell: candidate.command === 'pnpm' || candidate.command === 'npm',
    })
    if (result.status === 0) return true
    console.log(`  · ${candidate.label} 安装失败，尝试下一个方式…`)
  }
  return false
}

function run(command, args) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit' })
    child.on('exit', (code) => resolvePromise(code ?? 1))
  })
}

if (!existsSync(viteBin)) {
  console.log('[1/2] 首次运行，正在安装依赖（可能需要几分钟）…')
  if (!installDependencies()) {
    console.error('[错误] 依赖安装失败，请检查网络后重试。')
    process.exit(1)
  }
  console.log('')
}

if (mode === 'build') {
  console.log('================ 1/3 类型检查 ================')
  const typecheck = await run(process.execPath, [vueTscBin, '--noEmit', '-p', resolve(root, 'tsconfig.json')])
  if (typecheck !== 0) {
    console.error('\n[失败] 类型检查未通过。')
    process.exit(1)
  }

  console.log('\n================ 2/3 生产构建 ================')
  const build = await run(process.execPath, [viteBin, 'build'])
  if (build !== 0) {
    console.error('\n[失败] 构建未通过。')
    process.exit(1)
  }

  console.log('\n================ 3/3 构建产物冒烟测试 ================')
  const verify = await run(process.execPath, [resolve(root, 'scripts/verify-build.mjs')])
  if (verify !== 0) {
    console.error('\n[失败] 构建产物自检未通过。')
    process.exit(1)
  }

  console.log('\n全部完成：产物在 dist\\ 目录。运行 start.cmd 可继续本地调试。')
  process.exit(0)
}

const args = mode === 'preview' ? ['preview', ...extraArgs] : [...extraArgs]
if (!args.some((arg) => arg.startsWith('--port'))) args.push('--port', mode === 'preview' ? '5274' : '5273')

const url = `http://127.0.0.1:${args[args.indexOf('--port') + 1]}/`
console.log(`[2/2] 启动${mode === 'preview' ? '构建产物预览' : '开发服务器'}：${url}   （按 Ctrl+C 停止）\n`)

const child = spawn(process.execPath, [viteBin, ...args], { cwd: root, stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 0))
process.on('SIGINT', () => child.kill())
process.on('SIGTERM', () => child.kill())
