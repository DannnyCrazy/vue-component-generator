import { Readable } from 'node:stream'
import type { Connect, Plugin } from 'vite'

/**
 * 浏览器直连第三方 AI 平台时经常被 CORS 拦截（不少平台不返回 CORS 头）。
 * 这个开发/预览服务器中间件提供一个同源转发端点：
 *
 *   POST /__ai_proxy__   { url, method?, headers?, body? }
 *
 * 服务器用 Node fetch 去请求真正的接口，并把响应（含 SSE 流）原样回传。
 * 仅在 `vite dev` / `vite preview` 下可用；构建产物是纯静态站点，不含该端点。
 */
export const AI_PROXY_PATH = '/__ai_proxy__'

interface ProxyPayload {
  url?: unknown
  method?: unknown
  headers?: unknown
  body?: unknown
}

async function readBody(req: Connect.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk as Buffer))
  }
  return Buffer.concat(chunks).toString('utf8')
}

function createHandler(): Connect.NextHandleFunction {
  return async (req, res, next) => {
    if (!req.url || !req.url.startsWith(AI_PROXY_PATH)) {
      next()
      return
    }

    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.setHeader('access-control-allow-origin', '*')
      res.setHeader('access-control-allow-headers', '*')
      res.setHeader('access-control-allow-methods', 'POST, OPTIONS')
      res.end()
      return
    }

    if (req.method !== 'POST') {
      res.statusCode = 405
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: { message: '代理仅支持 POST' } }))
      return
    }

    const fail = (status: number, message: string) => {
      if (!res.headersSent) {
        res.statusCode = status
        res.setHeader('content-type', 'application/json; charset=utf-8')
      }
      res.end(JSON.stringify({ error: { message } }))
    }

    let payload: ProxyPayload
    try {
      payload = JSON.parse((await readBody(req)) || '{}') as ProxyPayload
    } catch {
      fail(400, '请求体不是合法 JSON')
      return
    }

    const target = typeof payload.url === 'string' ? payload.url : ''
    if (!/^https?:\/\//i.test(target)) {
      fail(400, 'url 必须是 http(s) 开头的绝对地址')
      return
    }

    const method = typeof payload.method === 'string' ? payload.method.toUpperCase() : 'POST'
    const headers =
      payload.headers && typeof payload.headers === 'object'
        ? { ...(payload.headers as Record<string, string>) }
        : {}
    const hasBody = payload.body !== undefined && payload.body !== null && method !== 'GET' && method !== 'HEAD'
    const body = hasBody
      ? typeof payload.body === 'string'
        ? payload.body
        : JSON.stringify(payload.body)
      : undefined

    if (body && !headers['content-type'] && !headers['Content-Type']) {
      headers['content-type'] = 'application/json'
    }

    try {
      const upstream = await fetch(target, { method, headers, body, redirect: 'follow' })
      res.statusCode = upstream.status
      const contentType = upstream.headers.get('content-type')
      if (contentType) res.setHeader('content-type', contentType)
      res.setHeader('cache-control', 'no-cache, no-transform')
      res.setHeader('x-accel-buffering', 'no')
      res.setHeader('connection', 'keep-alive')
      res.flushHeaders?.()

      if (upstream.body) {
        Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0])
          .on('error', () => res.end())
          .pipe(res)
      } else {
        res.end(await upstream.text())
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      fail(502, `代理请求失败：${message}`)
    }
  }
}

export function aiProxyPlugin(): Plugin {
  return {
    name: 'acs-ai-proxy',
    configureServer(server) {
      server.middlewares.use(createHandler())
      server.config.logger.info(
        `\n  \x1b[36m➜\x1b[0m  AI 代理已启用：\x1b[1m${AI_PROXY_PATH}\x1b[0m（用于绕过平台 CORS 限制）\n`,
      )
    },
    configurePreviewServer(server) {
      server.middlewares.use(createHandler())
    },
  }
}
