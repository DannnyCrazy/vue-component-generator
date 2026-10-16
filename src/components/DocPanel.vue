<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { apiState } from '@/stores/apiInspector'
import { analyzeComponent, buildUsageExample, describeVersion } from '@/services/componentDoc'
import { currentComponent, currentVersion, studio } from '@/stores/studio'
import { toast } from '@/composables/useToast'
import { copyText, downloadText } from '@/utils/misc'

/**
 * 「接入文档」标签页：从当前组件的代码里静态提取对外契约（props/emits/slots/expose/
 * 依赖/接口），拼成可以直接交给别人接入的 Markdown。切换组件时各自生成各自的文档。
 */

const showMarkdown = ref(false)

const doc = computed(() =>
  analyzeComponent(studio.code, {
    name: currentComponent.value?.name ?? 'GeneratedComponent',
    summary: currentComponent.value?.prompt ?? '',
    apis: apiState.calls.map((call) => ({ method: call.method, url: call.url })),
  }),
)

const usage = computed(() => buildUsageExample(doc.value))
const versionInfo = computed(() => describeVersion(currentVersion.value))

async function onCopyMarkdown(): Promise<void> {
  toast((await copyText(doc.value.markdown)) ? '接入文档已复制（Markdown）' : '复制失败', 'ok')
}

function onDownloadMarkdown(): void {
  downloadText(`${doc.value.componentName}.接入文档.md`, doc.value.markdown)
}

function onDownloadVue(): void {
  if (!studio.code.trim()) return
  downloadText(doc.value.fileName, studio.code)
}
</script>

<template>
  <section class="panel doc-panel">
    <header class="panel-head">
      <span class="panel-title"><AppIcon name="file" :size="15" /> 接入文档</span>
      <span class="muted subject truncate">
        {{ currentComponent ? `${doc.fileName}${versionInfo ? ` · ${versionInfo}` : ''}` : '当前组件 · 未选择' }}
      </span>
      <div class="panel-actions">
        <button class="btn btn-sm btn-ghost" type="button" :disabled="!studio.code" @click="showMarkdown = !showMarkdown">
          <AppIcon name="code" :size="13" />
          {{ showMarkdown ? '看排版' : '看 Markdown' }}
        </button>
        <button class="btn btn-sm btn-ghost" type="button" :disabled="!studio.code" title="复制 Markdown" @click="onCopyMarkdown">
          <AppIcon name="copy" :size="13" />
          复制
        </button>
        <button class="btn btn-sm btn-ghost" type="button" :disabled="!studio.code" title="下载 .md" @click="onDownloadMarkdown">
          <AppIcon name="download" :size="13" />
          .md
        </button>
        <button class="btn btn-sm btn-ghost" type="button" :disabled="!studio.code" title="下载 .vue" @click="onDownloadVue">
          <AppIcon name="download" :size="13" />
          .vue
        </button>
      </div>
    </header>

    <div class="doc-body scroll-y" data-testid="doc-body">
      <div v-if="!studio.code.trim()" class="empty-state">
        <span class="icon">📄</span>
        <h3>还没有可生成文档的组件</h3>
        <p>生成组件后，这里会从代码里提取 props / 事件 / 插槽 / 依赖与接口，自动写好接入文档。</p>
      </div>

      <pre v-else-if="showMarkdown" class="markdown mono" data-testid="doc-markdown">{{ doc.markdown }}</pre>

      <template v-else>
        <section class="doc-section">
          <h2>{{ doc.displayName }}</h2>
          <p v-if="doc.summary" class="summary">{{ doc.summary }}</p>
          <div class="facts">
            <span class="fact"><b>文件</b><code>{{ doc.fileName }}</code></span>
            <span class="fact"><b>脚本</b>{{ doc.lang }}</span>
            <span class="fact"><b>样式</b>{{ doc.scoped ? 'scoped（不外泄）' : '全局' }}</span>
            <span class="fact"><b>规模</b>{{ doc.lines }} 行 · {{ (doc.bytes / 1024).toFixed(1) }} KB</span>
            <span class="fact">
              <b>依赖</b>
              {{ doc.thirdPartyImports.length ? doc.thirdPartyImports.join('、') : '仅 vue，无第三方依赖' }}
            </span>
          </div>
        </section>

        <section class="doc-section" data-testid="doc-props">
          <h3>Props <span class="count">{{ doc.props.length }}</span></h3>
          <table v-if="doc.props.length" class="doc-table">
            <thead>
              <tr><th>名称</th><th>类型</th><th>必填</th><th>默认值</th><th>说明</th></tr>
            </thead>
            <tbody>
              <tr v-for="prop in doc.props" :key="prop.name">
                <td><code>{{ prop.name }}</code></td>
                <td><code class="type">{{ prop.type }}</code></td>
                <td>{{ prop.optional || prop.defaultValue !== undefined ? '否' : '是' }}</td>
                <td><code v-if="prop.defaultValue !== undefined">{{ prop.defaultValue }}</code><span v-else>—</span></td>
                <td>{{ prop.description || '—' }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="muted none">该组件不接收任何 props。</p>
        </section>

        <section class="doc-section" data-testid="doc-emits">
          <h3>Events <span class="count">{{ doc.emits.length }}</span></h3>
          <table v-if="doc.emits.length" class="doc-table">
            <thead><tr><th>事件</th><th>载荷</th></tr></thead>
            <tbody>
              <tr v-for="emit in doc.emits" :key="emit.name">
                <td><code>{{ emit.name }}</code></td>
                <td><code v-if="emit.payload" class="type">{{ emit.payload }}</code><span v-else>—</span></td>
              </tr>
            </tbody>
          </table>
          <p v-else class="muted none">该组件不对外派发事件。</p>
        </section>

        <section class="doc-section" data-testid="doc-slots">
          <h3>Slots <span class="count">{{ doc.slots.length }}</span></h3>
          <table v-if="doc.slots.length" class="doc-table">
            <thead><tr><th>插槽</th><th>作用域参数</th></tr></thead>
            <tbody>
              <tr v-for="slot in doc.slots" :key="slot.name">
                <td><code>{{ slot.name }}</code></td>
                <td><code v-if="slot.props" class="type">{{ slot.props }}</code><span v-else>—</span></td>
              </tr>
            </tbody>
          </table>
          <p v-else class="muted none">该组件不使用插槽。</p>
        </section>

        <section v-if="doc.exposes.length" class="doc-section">
          <h3>暴露的方法 / 属性</h3>
          <p class="muted small">通过模板引用（ref）可以访问：</p>
          <p class="exposes"><code v-for="name in doc.exposes" :key="name">{{ name }}</code></p>
        </section>

        <section class="doc-section" data-testid="doc-apis">
          <h3>接口依赖 <span class="count">{{ doc.apis.length }}</span></h3>
          <table v-if="doc.apis.length" class="doc-table">
            <thead><tr><th>方法</th><th>地址</th></tr></thead>
            <tbody>
              <tr v-for="api in doc.apis" :key="`${api.method} ${api.url}`">
                <td><code>{{ api.method }}</code></td>
                <td><code class="type">{{ api.url }}</code></td>
              </tr>
            </tbody>
          </table>
          <p v-else class="muted none">组件运行期没有请求过接口（数据都是内置的）。</p>
        </section>

        <section class="doc-section">
          <h3>使用示例</h3>
          <pre class="code-block mono" data-testid="doc-usage">{{ usage }}</pre>
        </section>
      </template>
    </div>
  </section>
</template>

<style scoped>
.doc-panel {
  flex: 1;
  min-height: 0;
}
.subject {
  font-size: 11.5px;
  max-width: 320px;
}
.doc-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 18px 24px;
}
.doc-section {
  margin-bottom: 20px;
}
.doc-section h2 {
  margin: 0 0 6px;
  font-size: 17px;
  color: var(--text-0);
}
.doc-section h3 {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 0 9px;
  font-size: 12.5px;
  letter-spacing: 0.4px;
  color: var(--text-1);
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
}
.count {
  font-family: var(--mono);
  font-size: 10.5px;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--bg-3);
  color: var(--text-2);
}
.summary {
  margin: 0 0 10px;
  font-size: 12.5px;
  color: var(--text-1);
  line-height: 1.7;
}
.facts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.fact {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg-2);
  font-size: 11.5px;
  color: var(--text-1);
}
.fact b {
  color: var(--text-2);
  font-weight: 600;
}
.doc-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.doc-table th {
  text-align: left;
  font-weight: 600;
  color: var(--text-2);
  font-size: 11px;
  padding: 6px 10px 6px 0;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.doc-table td {
  padding: 7px 10px 7px 0;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  color: var(--text-1);
  vertical-align: top;
}
.doc-table code {
  font-family: var(--mono);
  font-size: 11.5px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(127, 127, 127, 0.16);
  color: var(--text-0);
}
.doc-table code.type {
  background: transparent;
  padding: 0;
  color: var(--accent-2);
}
.none,
.small {
  font-size: 12px;
  margin: 0;
}
.exposes {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 6px 0 0;
}
.exposes code {
  font-family: var(--mono);
  font-size: 11.5px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--bg-2);
  border: 1px solid var(--border);
  color: var(--text-1);
}
.code-block,
.markdown {
  margin: 0;
  padding: 12px;
  border-radius: var(--radius-sm);
  background: var(--bg-0);
  border: 1px solid var(--border);
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--text-1);
  white-space: pre-wrap;
  word-break: break-word;
}
.markdown {
  font-size: 12px;
  color: var(--text-0);
}
.empty-state {
  gap: 10px;
  padding-top: 60px;
}
.empty-state h3 {
  border: none;
  padding: 0;
}
</style>
