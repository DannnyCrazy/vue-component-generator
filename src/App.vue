<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppHeader from '@/components/AppHeader.vue'
import SettingsDialog from '@/components/SettingsDialog.vue'
import ToastHost from '@/components/ToastHost.vue'
import { workModeOfRoute } from '@/router'
import { studio, switchWorkMode, syncFromLibrary, workMode } from '@/stores/studio'

/**
 * 应用外壳：顶部栏 + 路由页面（#/project 与 #/scratch 是两个独立组件）+ 全局弹窗。
 * 路由决定当前工作形态，stores 里的 workMode 跟着路由走。
 */

const route = useRoute()

const settingsOpen = ref(false)
const settingsTab = ref<'platform' | 'generation'>('platform')

function openSettings(tab: 'platform' | 'generation' = 'platform'): void {
  settingsTab.value = tab
  settingsOpen.value = true
}

// 启动时载入当前组件的代码，刷新页面后接着用
syncFromLibrary()

// 路由 → 工作形态（两个页面的数据各自独立）
watch(
  () => route.name,
  (name) => {
    const mode = workModeOfRoute(name)
    if (mode !== workMode.value) switchWorkMode(mode)
  },
  { immediate: true },
)

// 进入某个页面时把 studio.mode 调整到合理的初始值
watch(
  () => route.name,
  () => {
    if (studio.mode === 'modify' && !studio.code.trim()) studio.mode = 'create'
  },
)
</script>

<template>
  <div class="app-shell">
    <AppHeader @open-settings="openSettings" />

    <RouterView v-slot="{ Component }">
      <component :is="Component" @open-settings="openSettings" />
    </RouterView>

    <SettingsDialog v-model:open="settingsOpen" :tab="settingsTab" />
    <ToastHost />
  </div>
</template>

<style scoped>
.app-shell {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
</style>
