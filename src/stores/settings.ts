import { computed, reactive, watch } from 'vue'
import type { ProviderProfile, SettingsState } from '@/types'
import { createProfile, defaultSettings, getPreset } from '@/config/presets'
import { loadJson, saveJson, uid } from '@/utils/misc'

const STORAGE_KEY = 'acs.settings.v1'
const THEME_KEY = 'acs.theme'

function hydrate(): SettingsState {
  const defaults = defaultSettings()
  const stored = loadJson<Partial<SettingsState> | null>(STORAGE_KEY, null)
  if (!stored) return defaults

  const profiles = Array.isArray(stored.profiles) && stored.profiles.length
    ? stored.profiles.map((profile) => ({
        ...createProfile(profile.presetId || 'custom'),
        ...profile,
        models: Array.isArray(profile.models) ? profile.models : [],
      }))
    : defaults.profiles

  const activeProfileId = profiles.some((p) => p.id === stored.activeProfileId)
    ? (stored.activeProfileId as string)
    : profiles[0].id

  // 逐字段取值：旧版本 localStorage 里可能残留已废弃的配置项（如输出目标 / 脚本语言），
  // 这里显式构造，避免它们又被写回存储。
  const storedUi = (stored.ui ?? {}) as Record<string, unknown>
  return {
    profiles,
    activeProfileId,
    generation: {
      scopedStyle: stored.generation?.scopedStyle ?? defaults.generation.scopedStyle,
      themeAware: stored.generation?.themeAware ?? defaults.generation.themeAware,
      extraSystemPrompt: stored.generation?.extraSystemPrompt ?? defaults.generation.extraSystemPrompt,
    },
    ui: {
      theme: (storedUi.theme as SettingsState['ui']['theme']) ?? defaults.ui.theme,
      isolation: (storedUi.isolation as SettingsState['ui']['isolation']) ?? defaults.ui.isolation,
      autoReload: (storedUi.autoReload as boolean) ?? defaults.ui.autoReload,
      reloadDelay: (storedUi.reloadDelay as number) ?? defaults.ui.reloadDelay,
      captureConsole: (storedUi.captureConsole as boolean) ?? defaults.ui.captureConsole,
      allowRemoteImports: (storedUi.allowRemoteImports as boolean) ?? defaults.ui.allowRemoteImports,
      showReasoning: (storedUi.showReasoning as boolean) ?? defaults.ui.showReasoning,
      workMode: (storedUi.workMode as SettingsState['ui']['workMode']) ?? defaults.ui.workMode,
      // 兼容旧字段名 promptPanelWidth
      leftPanelWidth: (storedUi.leftPanelWidth as number) ?? (storedUi.promptPanelWidth as number) ?? defaults.ui.leftPanelWidth,
      historyCollapsed: (storedUi.historyCollapsed as boolean) ?? defaults.ui.historyCollapsed,
      historyWidth: (storedUi.historyWidth as number) ?? defaults.ui.historyWidth,
    },
  }
}

export const settingsState = reactive<SettingsState>(hydrate())

// 首屏主题：index.html 已经用 localStorage 里的 acs.theme 预置过
try {
  const savedTheme = localStorage.getItem(THEME_KEY)
  if (savedTheme === 'light' || savedTheme === 'dark') settingsState.ui.theme = savedTheme
} catch {
  /* ignore */
}

function applyTheme(theme: string): void {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    /* ignore */
  }
}

applyTheme(settingsState.ui.theme)

watch(
  settingsState,
  (value) => {
    saveJson(STORAGE_KEY, value)
  },
  { deep: true },
)

watch(
  () => settingsState.ui.theme,
  (theme) => applyTheme(theme),
)

export const activeProfile = computed<ProviderProfile>(() => {
  return (
    settingsState.profiles.find((profile) => profile.id === settingsState.activeProfileId) ??
    settingsState.profiles[0]
  )
})

export const isProfileReady = computed(() => {
  const profile = activeProfile.value
  if (!profile) return false
  const noKeyNeeded = /localhost|127\.0\.0\.1/.test(profile.baseUrl)
  return Boolean(profile.baseUrl.trim() && profile.model.trim() && (profile.apiKey.trim() || noKeyNeeded))
})

export function addProfile(presetId = 'custom'): ProviderProfile {
  const profile = createProfile(presetId)
  if (presetId === 'custom') profile.name = `自定义平台 ${settingsState.profiles.length + 1}`
  settingsState.profiles.push(profile)
  settingsState.activeProfileId = profile.id
  return profile
}

export function duplicateProfile(id: string): ProviderProfile | null {
  const source = settingsState.profiles.find((profile) => profile.id === id)
  if (!source) return null
  const copy: ProviderProfile = {
    ...source,
    id: uid('prov'),
    name: `${source.name} 副本`,
    models: [...source.models],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  settingsState.profiles.push(copy)
  settingsState.activeProfileId = copy.id
  return copy
}

export function removeProfile(id: string): void {
  const index = settingsState.profiles.findIndex((profile) => profile.id === id)
  if (index < 0) return
  if (settingsState.profiles.length === 1) return
  settingsState.profiles.splice(index, 1)
  if (settingsState.activeProfileId === id) {
    settingsState.activeProfileId = settingsState.profiles[0].id
  }
}

export function selectProfile(id: string): void {
  if (settingsState.profiles.some((profile) => profile.id === id)) {
    settingsState.activeProfileId = id
  }
}

export function updateActiveProfile(patch: Partial<ProviderProfile>): void {
  const profile = activeProfile.value
  if (!profile) return
  Object.assign(profile, patch, { updatedAt: Date.now() })
}

export function applyPreset(presetId: string): void {
  const preset = getPreset(presetId)
  updateActiveProfile({
    presetId: preset.id,
    name: preset.id === 'custom' ? activeProfile.value.name : preset.name,
    flavor: preset.flavor,
    baseUrl: preset.baseUrl,
    path: preset.path,
    model: preset.models[0] ?? activeProfile.value.model,
    models: [...preset.models],
    useProxy: preset.useProxy ?? false,
    anthropicVersion: preset.flavor === 'anthropic' ? '2023-06-01' : undefined,
  })
}

export function resetAllSettings(): void {
  const defaults = defaultSettings()
  settingsState.profiles = defaults.profiles
  settingsState.activeProfileId = defaults.activeProfileId
  settingsState.generation = defaults.generation
  settingsState.ui = defaults.ui
}
