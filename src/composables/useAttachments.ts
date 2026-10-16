import { ref } from 'vue'
import { addAttachments } from '@/stores/studio'
import { toast } from '@/composables/useToast'

/** 对话框里的参考文件：两个工作区的 composer 共用这段逻辑 */
export function useAttachments() {
  const fileInput = ref<HTMLInputElement | null>(null)
  const dragging = ref(false)

  async function handleFiles(files: File[]): Promise<void> {
    if (!files.length) return
    const { added, skipped } = await addAttachments(files)
    if (added) toast(`已添加 ${added} 个参考文件`, 'ok')
    if (skipped.length) toast(`已跳过 ${skipped.length} 个文件：${skipped.join('、')}`, 'err', 5000)
  }

  async function onPick(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement
    await handleFiles(Array.from(input.files ?? []))
    input.value = ''
  }

  async function onDrop(event: DragEvent): Promise<void> {
    dragging.value = false
    const files = Array.from(event.dataTransfer?.files ?? [])
    if (files.length) await handleFiles(files)
  }

  function openPicker(): void {
    fileInput.value?.click()
  }

  /** 配合模板里的 :ref="setFileInput" 使用，避免出现"声明了但没用"的局部变量 */
  function setFileInput(el: unknown): void {
    fileInput.value = (el as HTMLInputElement | null) ?? null
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  return { fileInput, dragging, onPick, onDrop, openPicker, setFileInput, formatSize, handleFiles }
}
