<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { apiState } from '@/stores/apiInspector'
import { previewState } from '@/services/previewManager'
import { currentComponent, currentVersion, studio, versionCount, versionIndex } from '@/stores/studio'
import { formatDuration, formatTime } from '@/utils/misc'

/**
 * 左栏上半：当前组件的「输入 → 输出」信息。
 * 输入 = 需求 / 修改说明 / 参考资料 / 模型
 * 输出 = 代码规模 / 版本 / 耗时 / 预览状态 / 接口数量
 */

interface InfoRow {
  label: string
  value: string
  mono?: boolean
  tone?: 'ok' | 'warn' | 'err' | 'muted'
}

const component = computed(() => currentComponent.value)
const version = computed(() => currentVersion.value)

const codeStats = computed(() => {
  const code = studio.code ?? ''
  const lines = code ? code.split('\n').length : 0
  const bytes = new TextEncoder().encode(code).length
  return { lines, bytes }
})

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

const previewTone = computed<InfoRow['tone']>(() => {
  switch (previewState.status) {
    case 'ready':
      return 'ok'
    case 'error':
      return 'err'
    case 'compiling':
    case 'waiting':
      return 'warn'
    default:
      return 'muted'
  }
})

const previewText = computed(() => {
  switch (previewState.status) {
    case 'ready':
      return `已实时加载 · 编译 ${Math.round(previewState.compileMs)}ms · 挂载 ${Math.round(previewState.mountMs)}ms`
    case 'compiling':
      return '编译中…'
    case 'waiting':
      return previewState.message || '等待代码完整'
    case 'error':
      return `加载失败：${previewState.message.split('\n')[0].slice(0, 60)}`
    default:
      return '待生成'
  }
})

const inputRows = computed<InfoRow[]>(() => {
  const rows: InfoRow[] = []
  if (!component.value) return rows
  rows.push({ label: '首次需求', value: component.value.prompt || '—' })
  const isFirst = versionIndex.value <= 0
  rows.push({
    label: isFirst ? '本次说明' : `v${versionIndex.value + 1} 修改`,
    value: isFirst ? '（首次生成）' : version.value?.prompt || '—',
    tone: isFirst ? 'muted' : undefined,
  })
  const files = version.value?.attachments ?? []
  rows.push({
    label: '参考资料',
    value: files.length ? files.map((file) => `${file.name}（${formatBytes(file.size)}）`).join('、') : '无',
    tone: files.length ? undefined : 'muted',
  })
  rows.push({
    label: '模型',
    value: version.value ? `${version.value.providerName || '未知平台'} · ${version.value.model || '未知模型'}` : '—',
  })
  return rows
})

const outputRows = computed<InfoRow[]>(() => {
  if (!component.value) return []
  const rows: InfoRow[] = []
  rows.push({
    label: '代码',
    value: `${codeStats.value.lines} 行 · ${formatBytes(codeStats.value.bytes)}`,
    mono: true,
  })
  rows.push({
    label: '版本',
    value: `v${versionIndex.value + 1} / 共 ${versionCount.value} 个`,
    mono: true,
    tone: version.value?.edited ? 'warn' : undefined,
  })
  rows.push({
    label: '生成耗时',
    value: version.value?.durationMs ? formatDuration(version.value.durationMs) : '—',
    mono: true,
  })
  rows.push({ label: '预览', value: previewText.value, tone: previewTone.value })
  rows.push({
    label: '接口',
    value: apiState.calls.length ? `${apiState.calls.length} 个已采集` : '暂无',
    tone: apiState.calls.length ? 'ok' : 'muted',
  })
  if (version.value?.edited) {
    rows.push({ label: '代码状态', value: '已手动编辑过', tone: 'warn' })
  }
  return rows
})
</script>

<template>
  <section class="panel info-panel">
    <header class="panel-head">
      <span class="panel-title"><AppIcon name="layers" :size="15" /> 组件信息</span>
      <span v-if="component" class="badge" :class="{ 'badge-ok': versionCount > 0 }">
        v{{ versionIndex + 1 }} / {{ versionCount }}
      </span>
      <span v-if="component" class="muted updated">{{ formatTime(component.updatedAt) }}</span>
    </header>

    <div class="info-body scroll-y" data-testid="component-info">
      <div v-if="!component" class="empty-state">
        <span class="icon">🧩</span>
        <h3>还没有组件</h3>
        <p>在右下角的对话框里描述需求，生成后这里会显示它的输入与输出信息。</p>
      </div>

      <template v-else>
        <div class="component-name" :title="component.name">{{ component.name }}</div>

        <div class="info-group">
          <div class="group-title">
            <AppIcon name="wand" :size="12" />
            输入
          </div>
          <div v-for="row in inputRows" :key="row.label" class="info-row">
            <span class="row-label">{{ row.label }}</span>
            <span class="row-value" :class="[row.tone, { mono: row.mono }]">{{ row.value }}</span>
          </div>
        </div>

        <div class="info-group">
          <div class="group-title">
            <AppIcon name="code" :size="12" />
            输出
          </div>
          <div v-for="row in outputRows" :key="row.label" class="info-row">
            <span class="row-label">{{ row.label }}</span>
            <span class="row-value" :class="[row.tone, { mono: row.mono }]">{{ row.value }}</span>
          </div>
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.info-panel {
  flex: 1 1 50%;
  min-height: 190px;
}
.updated {
  font-size: 11px;
  margin-left: auto;
}
.info-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.component-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-0);
  line-height: 1.5;
  word-break: break-word;
}
.info-group {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.group-title {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1px;
  color: var(--text-2);
  padding-bottom: 5px;
  border-bottom: 1px solid var(--border);
}
.info-row {
  display: flex;
  gap: 10px;
  font-size: 12px;
  line-height: 1.6;
}
.row-label {
  flex: none;
  width: 56px;
  color: var(--text-2);
}
.row-value {
  flex: 1;
  min-width: 0;
  color: var(--text-1);
  word-break: break-word;
}
.row-value.mono {
  font-family: var(--mono);
  font-size: 11.5px;
}
.row-value.ok {
  color: var(--accent);
}
.row-value.warn {
  color: var(--warn);
}
.row-value.err {
  color: var(--danger);
}
.row-value.muted {
  color: var(--text-2);
}
.empty-state {
  flex: 1;
  gap: 8px;
}
.empty-state h3 {
  font-size: 13.5px;
}
.empty-state p {
  font-size: 12px;
}
</style>
