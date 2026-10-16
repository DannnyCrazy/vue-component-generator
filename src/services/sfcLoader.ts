import * as Vue from 'vue'
import type { Component } from 'vue'
import { pauseCapture, resumeCapture } from '@/stores/apiInspector'
import { textOf } from '@/utils/misc'

/**
 * 浏览器内编译 Vue 单文件组件。
 *
 * 使用 vue3-sfc-loader（内含 @vue/compiler-sfc 的浏览器构建）把 SFC 源码编译成组件对象，
 * 并通过 moduleCache 让生成代码里的 `import { ref } from 'vue'` 直接复用宿主应用的
 * Vue 实例 —— 这样生成出来的组件与当前网站共享同一套响应式系统，
 * 可以真正「挂载在当前网站的 DOM 里」，而不是丢进 iframe。
 */

export interface CompileContext {
  /** <style> 注入位置：ShadowRoot 内的容器或 document.head */
  styleHost: HTMLElement
  /** 是否允许 import/加载 http(s) 远程 ESM 模块 */
  allowRemoteImports: boolean
  /** 编译期日志（模板/脚本编译提示） */
  onLog?: (level: 'error' | 'warn' | 'info', message: string) => void
}

type LoaderModule = typeof import('vue3-sfc-loader')
type LoaderOptions = Parameters<LoaderModule['loadModule']>[1]

let loaderPromise: Promise<LoaderModule> | null = null

/** 按需加载编译器，避免首屏就下载 1.8MB 的编译内核 */
function getLoader(): Promise<LoaderModule> {
  loaderPromise ??= import('vue3-sfc-loader')
  return loaderPromise
}

/** 提供给生成代码的 vue 模块（含 default，兼容 `import Vue from 'vue'`） */
const vueModule = Object.assign(Object.create(null), Vue, { default: Vue }) as Record<string, unknown>

let fileSeq = 0

function describeImportError(specifier: string): Error {
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    return new Error(
      `不支持相对路径导入「${specifier}」。生成规范要求把组件写成单个 SFC 文件，请把依赖的代码合并进当前文件。`,
    )
  }
  return new Error(
    `不支持的外部依赖「${specifier}」。当前环境只允许 import 'vue'（以及可选的 http(s) 完整地址模块），` +
      '请把该功能用原生 JavaScript 或 CSS 自行实现。',
  )
}

/** 加载远程 ESM 模块（不计入接口采集） */
async function fetchRemote(url: string): Promise<Response> {
  pauseCapture()
  try {
    return await fetch(url)
  } finally {
    resumeCapture()
  }
}

/** 把 vue3-sfc-loader 抛出的各种形态的错误统一成 Error */
export function normalizeCompileError(error: unknown): Error {  if (error instanceof Error) return error
  const record = (error ?? {}) as Record<string, any>
  const parts = [
    typeof record.message === 'string' ? record.message : '',
    typeof record.err?.message === 'string' ? record.err.message : '',
    typeof error === 'string' ? error : '',
    typeof record.codeFrame === 'string' ? record.codeFrame : '',
  ].filter(Boolean)
  return new Error(parts.join('\n\n') || '组件编译失败')
}

export async function compileComponent(code: string, ctx: CompileContext): Promise<Component> {
  const { loadModule } = await getLoader()
  const filename = `Generated_${Date.now().toString(36)}_${++fileSeq}.vue`

  const options: Partial<LoaderOptions> = {
    moduleCache: Object.assign(Object.create(null), { vue: vueModule }),
    getFile: async (path: string) => {
      if (path === filename) return code
      if (/^https?:\/\//i.test(path)) {
        if (!ctx.allowRemoteImports) {
          throw new Error(`已禁用远程模块加载，「${path}」被拒绝。可在设置中开启「允许 CDN 模块」。`)
        }
        const response = await fetchRemote(path)
        if (!response.ok) throw new Error(`远程模块加载失败（HTTP ${response.status}）：${path}`)
        return await response.text()
      }
      throw describeImportError(path)
    },
    addStyle: (style: string) => {
      const el = document.createElement('style')
      el.setAttribute('data-acs-style', '1')
      el.textContent = style
      ctx.styleHost.appendChild(el)
    },
    log: (type: string, ...args: unknown[]) => {
      const level = type === 'error' ? 'error' : type === 'warn' ? 'warn' : 'info'
      ctx.onLog?.(level, args.map((arg) => textOf(arg)).join(' '))
    },
    devMode: true,
  }

  try {
    return (await loadModule(filename, options as unknown as LoaderOptions)) as Component
  } catch (error) {
    throw normalizeCompileError(error)
  }
}
