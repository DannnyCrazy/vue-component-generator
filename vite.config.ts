import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { aiProxyPlugin } from './server/aiProxyPlugin'

export default defineConfig({
  plugins: [vue(), aiProxyPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5273,
    strictPort: false,
    open: false,
  },
  preview: {
    host: '127.0.0.1',
    port: 5274,
    strictPort: false,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // 两种工作形态各自打成一个独立 chunk（页面 + 它专属的对话框），
        // 两者共用的面板放到公共 chunk，避免产物之间互相依赖。
        manualChunks(id: string) {
          if (id.includes('/src/views/ProjectWorkspace') || id.includes('/src/components/composers/ProjectComposer')) {
            return 'workspace-project'
          }
          if (id.includes('/src/views/ScratchWorkspace') || id.includes('/src/components/composers/ScratchComposer')) {
            return 'workspace-scratch'
          }
          if (id.includes('/src/components/') || id.includes('/src/composables/')) return 'workspace-shared'
          return undefined
        },
      },
    },
  },
})
