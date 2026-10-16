<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { apiState, sendTest, statusClassOf } from '@/stores/apiInspector'
import type { CapturedApi } from '@/stores/apiInspector'
import { toast } from '@/composables/useToast'

const selected = computed<CapturedApi | null>(
  () => apiState.calls.find((call) => call.id === apiState.selectedId) ?? null,
)

const draft = reactive({
  method: 'GET',
  url: '',
  headersText: '{}',
  body: '',
})

watch(
  selected,
  (call) => {
    if (!call) return
    draft.method = call.method
    draft.url = call.url
    draft.headersText = Object.keys(call.headers).length ? JSON.stringify(call.headers, null, 2) : '{}'
    draft.body = call.body
  },
  { immediate: true },
)

const bodyDisabled = computed(() => draft.method === 'GET' || draft.method === 'HEAD')

function shortUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return url
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

async function onSend(): Promise<void> {
  if (!draft.url.trim()) {
    toast('请先填写请求地址', 'err')
    return
  }
  let headers: Record<string, string> = {}
  const raw = draft.headersText.trim()
  if (raw && raw !== '{}') {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      headers = Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]))
    } catch {
      toast('请求头不是合法的 JSON', 'err')
      return
    }
  }
  await sendTest({ method: draft.method, url: draft.url.trim(), headers, body: draft.body })
  const result = apiState.test
  if (result && result.ok) toast(`测试成功：HTTP ${result.status}`, 'ok')
  else if (result) toast(result.error || `测试失败：HTTP ${result.status ?? '—'}`, 'err', 4000)
}

function formatJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}
</script>

<template>
  <div class="api-panel">
    <p class="hint api-hint">
      采集当前组件在预览挂载期间发起的 <code>fetch</code> / <code>XMLHttpRequest</code> 请求；点击某条记录可以修改参数并重新发送测试。
    </p>

    <div v-if="!apiState.calls.length" class="empty-tip muted">
      <AppIcon name="link" :size="18" />
      <span>
        还没有采集到接口。<br />
        如果组件需要真实接口，可以在需求里写明「用 fetch 调用 http://…」，组件一旦发起请求就会出现在这里。
      </span>
    </div>

    <ul v-else class="api-list">
      <li
        v-for="call in apiState.calls"
        :key="call.id"
        :class="{ active: call.id === apiState.selectedId }"
        @click="apiState.selectedId = call.id"
      >
        <span class="method" :class="call.method.toLowerCase()">{{ call.method }}</span>
        <span class="api-main">
          <span class="api-url truncate">{{ shortUrl(call.url) }}</span>
          <span class="api-host truncate">{{ hostOf(call.url) }}</span>
        </span>
        <span class="api-meta">
          <span class="status" :class="statusClassOf(call)">{{ call.error ? 'ERR' : (call.status ?? '—') }}</span>
          <span class="dur">{{ Math.round(call.durationMs) }}ms</span>
          <span v-if="call.count > 1" class="count">×{{ call.count }}</span>
        </span>
      </li>
    </ul>

    <div v-if="selected" class="api-detail">
      <div class="detail-head">
        <span class="label">接口测试</span>
        <span class="muted">修改后点击「发送测试」，不会影响组件本身</span>
      </div>

      <div class="row request-line">
        <select v-model="draft.method" class="select method-select">
          <option>GET</option>
          <option>POST</option>
          <option>PUT</option>
          <option>PATCH</option>
          <option>DELETE</option>
          <option>HEAD</option>
        </select>
        <input v-model="draft.url" class="input mono" type="text" spellcheck="false" placeholder="https://api.example.com/v1/users" />
      </div>

      <label class="field-mini">
        <span>请求头（JSON）</span>
        <textarea v-model="draft.headersText" class="textarea mono" rows="2" spellcheck="false"></textarea>
      </label>

      <label class="field-mini">
        <span>请求体{{ bodyDisabled ? '（该请求方法无请求体）' : '' }}</span>
        <textarea
          v-model="draft.body"
          class="textarea mono"
          rows="3"
          spellcheck="false"
          :disabled="bodyDisabled"
          placeholder="请求体内容"
        ></textarea>
      </label>

      <div class="row">
        <button class="btn btn-primary btn-sm" type="button" :disabled="apiState.testing" @click="onSend">
          <span v-if="apiState.testing" class="spinner"></span>
          <AppIcon v-else name="bolt" :size="13" />
          发送测试
        </button>
        <span v-if="selected.hasBinaryBody" class="muted">组件发起时使用了非文本请求体，这里无法复现</span>
      </div>

      <div v-if="apiState.test" class="test-result" :class="apiState.test.ok ? 'ok' : 'err'">
        <div class="test-head">
          <AppIcon :name="apiState.test.ok ? 'check' : 'alert'" :size="13" />
          <strong>{{ apiState.test.error ? '请求失败' : `HTTP ${apiState.test.status}` }}</strong>
          <span class="muted">{{ Math.round(apiState.test.durationMs) }} ms</span>
        </div>
        <pre v-if="apiState.test.error" class="mono box">{{ apiState.test.error }}</pre>
        <pre v-else class="mono box">{{ formatJson(apiState.test.body) }}</pre>
      </div>

      <details v-if="selected.responseBody" class="response">
        <summary>最近一次组件收到的响应</summary>
        <pre class="mono box">{{ formatJson(selected.responseBody) }}</pre>
      </details>

      <details v-if="selected.error" class="response">
        <summary>最近一次请求的错误</summary>
        <pre class="mono box">{{ selected.error }}</pre>
      </details>
    </div>
  </div>
</template>

<style scoped>
.api-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  overflow-y: auto;
}
.api-hint {
  flex: none;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--text-2);
}
.api-hint code {
  font-family: var(--mono);
  font-size: 11px;
  padding: 1px 4px;
  border-radius: 4px;
  background: rgba(127, 127, 127, 0.16);
}
.empty-tip {
  display: flex;
  gap: 9px;
  align-items: flex-start;
  font-size: 12px;
  line-height: 1.7;
  padding: 14px 4px;
}
.api-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  /* flex: none 很关键：否则在 flex 列里会被压缩到 0 高度，
     列表项虽然还在布局盒里，却已被 overflow 裁掉、无法点击 */
  flex: none;
  max-height: 210px;
  overflow-y: auto;
}
.api-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 0.16s, border-color 0.16s;
}
.api-list li:hover {
  background: var(--bg-2);
}
.api-list li.active {
  background: var(--accent-soft);
  border-color: var(--accent-line);
}
.method {
  flex: none;
  font-family: var(--mono);
  font-size: 10.5px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--bg-3);
  color: var(--text-1);
}
.method.get {
  color: #42d392;
}
.method.post {
  color: #647eff;
}
.method.put,
.method.patch {
  color: #ffb84d;
}
.method.delete {
  color: #ff5f6d;
}
.api-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.35;
}
.api-url {
  font-size: 12px;
  color: var(--text-0);
}
.api-host {
  font-size: 10.5px;
  color: var(--text-2);
}
.api-meta {
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-2);
}
.status {
  font-family: var(--mono);
  font-weight: 600;
}
.status.ok {
  color: var(--accent);
}
.status.err {
  color: var(--danger);
}
.status.pending {
  color: var(--text-2);
}
.count {
  padding: 0 5px;
  border-radius: 999px;
  background: var(--bg-3);
}
.api-detail {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
.detail-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 11.5px;
}
.request-line {
  gap: 6px;
}
.method-select {
  flex: none;
  width: 96px;
  padding: 8px 26px 8px 10px;
  background-position: calc(100% - 15px) 15px, calc(100% - 10px) 15px;
}
.field-mini {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.field-mini > span {
  font-size: 11px;
  color: var(--text-2);
  font-weight: 600;
}
.test-result {
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  padding: 9px;
  background: var(--bg-2);
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.test-result.ok {
  border-color: var(--accent-line);
}
.test-result.err {
  border-color: color-mix(in srgb, var(--danger) 40%, transparent);
}
.test-head {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
}
.test-result.ok .test-head {
  color: var(--accent);
}
.test-result.err .test-head {
  color: var(--danger);
}
.box {
  margin: 0;
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 11px;
  line-height: 1.65;
  color: var(--text-1);
  background: var(--bg-0);
  border-radius: 6px;
  padding: 8px;
}
.response summary {
  font-size: 11.5px;
  color: var(--text-2);
  cursor: pointer;
  margin-bottom: 6px;
}
</style>
