import { createRouter, createWebHashHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { settingsState } from '@/stores/settings'

/**
 * 两种工作形态是两个独立的路由页面，各自打包成一个 chunk：
 *   #/project  项目模式（多组件 + 对话 + 版本历史）
 *   #/scratch  临时模式（用完即走）
 *
 * 用 hash 路由是为了让 dist/ 直接丢到任意静态服务器（甚至本地打开）都能用，
 * 不需要服务端配置 history fallback。
 */
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    // 回到上次用的形态
    redirect: () => (settingsState.ui.workMode === 'scratch' ? '/scratch' : '/project'),
  },
  {
    path: '/project',
    name: 'project',
    component: () => import('@/views/ProjectWorkspace.vue'),
    meta: { workMode: 'project', title: '项目模式' },
  },
  {
    path: '/scratch',
    name: 'scratch',
    component: () => import('@/views/ScratchWorkspace.vue'),
    meta: { workMode: 'scratch', title: '临时模式' },
  },
  { path: '/:pathMatch(.*)*', redirect: '/project' },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

export function workModeOfRoute(name: unknown): 'project' | 'scratch' {
  return name === 'scratch' ? 'scratch' : 'project'
}
