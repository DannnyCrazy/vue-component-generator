import { reactive } from 'vue'

export interface ToastItem {
  id: number
  text: string
  type: 'info' | 'ok' | 'err'
}

const items = reactive<ToastItem[]>([])
let seq = 0

export function toast(text: string, type: ToastItem['type'] = 'info', duration = 2600): void {
  const id = ++seq
  items.push({ id, text, type })
  window.setTimeout(() => {
    const index = items.findIndex((item) => item.id === id)
    if (index >= 0) items.splice(index, 1)
  }, duration)
}

export function useToast() {
  return { items, toast }
}
