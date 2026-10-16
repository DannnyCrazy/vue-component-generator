import { computed, ref } from 'vue'
import { apiState, clearCalls, resetCaptureScope } from '@/stores/apiInspector'
import { settingsState } from '@/stores/settings'
import { currentComponent, currentVersion, studio, versionCount, versionIndex } from '@/stores/studio'
import { toast } from '@/composables/useToast'
import { clamp } from '@/utils/misc'

/** 两个工作区共用的页面骨架逻辑：标签页、分栏拖拽、状态行、接口清空 */
export type WorkspaceTab = 'preview' | 'code' | 'raw' | 'chat' | 'doc'

export function useWorkspaceLayout(tabs: WorkspaceTab[], initialTab: WorkspaceTab = 'preview') {
  const activeTab = ref<WorkspaceTab>(initialTab)
  const resizing = ref(false)

  function switchTab(tab: WorkspaceTab): void {
    if (tabs.includes(tab)) activeTab.value = tab
  }

  /** 顶部那行说明：说清当前看的是哪个版本 */
  const stageHint = computed(() => {
    const component = currentComponent.value
    const version = currentVersion.value
    if (!component || !version) {
      return studio.source === 'demo' ? '当前为内置示例组件' : '描述需求 → 生成 → 实时加载'
    }
    const label = `v${versionIndex.value + 1}`
    if (studio.source === 'manual') return `${label} · 已手动编辑，预览会自动跟随`
    const isLatest = versionIndex.value === component.versions.length - 1
    if (isLatest) {
      return `${label} · 由 ${version.providerName || '未知平台'} · ${version.model || '未知模型'} 生成`
    }
    return `正在查看历史版本 ${label}（最新为 v${component.versions.length}）`
  })

  const versionLabel = computed(() => (versionCount.value ? `v${versionIndex.value + 1} / ${versionCount.value}` : ''))

  function clearApis(): void {
    clearCalls()
    resetCaptureScope()
    toast('已清空当前组件的接口记录', 'info')
  }

  function dragWidth(
    event: PointerEvent,
    startWidth: number,
    apply: (width: number) => void,
    min: number,
    max: number,
    invert = false,
  ): void {
    resizing.value = true
    const startX = event.clientX
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture(event.pointerId)

    const onMove = (moveEvent: PointerEvent) => {
      const delta = (moveEvent.clientX - startX) * (invert ? -1 : 1)
      apply(clamp(startWidth + delta, min, max))
    }
    const onUp = () => {
      resizing.value = false
      target.releasePointerCapture(event.pointerId)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  function onResizeLeft(event: PointerEvent): void {
    dragWidth(event, settingsState.ui.leftPanelWidth, (width) => {
      settingsState.ui.leftPanelWidth = width
    }, 280, 620)
  }

  function onResizeHistory(event: PointerEvent): void {
    dragWidth(
      event,
      settingsState.ui.historyWidth,
      (width) => {
        settingsState.ui.historyWidth = width
      },
      220,
      460,
      true,
    )
  }

  return {
    activeTab,
    resizing,
    switchTab,
    stageHint,
    versionLabel,
    clearApis,
    onResizeLeft,
    onResizeHistory,
    apiState,
    settingsState,
    studio,
  }
}

/** 两个工作区共用的快捷键 */
export function bindWorkspaceShortcuts(options: {
  onTab: (tab: WorkspaceTab) => void
  onSettings: () => void
}): () => void {
  const handler = (event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey)) return
    if (event.key === ',') {
      event.preventDefault()
      options.onSettings()
    } else if (event.key === '1') options.onTab('preview')
    else if (event.key === '2') options.onTab('code')
    else if (event.key === '3') options.onTab('raw')
    else if (event.key === '4') options.onTab('doc')
  }
  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}
