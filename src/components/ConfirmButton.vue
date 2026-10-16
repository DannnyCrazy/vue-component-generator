<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'

/**
 * 需要二次确认的按钮：第一次点击变成「确认 / 取消」，5 秒内没确认会自动收回。
 * 用于所有「清空」这类不可撤销的操作。
 */
const props = withDefaults(
  defineProps<{
    label: string
    confirmText?: string
    buttonClass?: string
    confirmClass?: string
    disabled?: boolean
    title?: string
    testid?: string
  }>(),
  {
    confirmText: '确认清空',
    buttonClass: 'btn btn-sm btn-ghost',
    confirmClass: 'btn btn-sm btn-danger',
    disabled: false,
  },
)

const emit = defineEmits<{ (event: 'confirm'): void }>()

const pending = ref(false)
let timer: ReturnType<typeof setTimeout> | null = null

function clearTimer(): void {
  if (timer) clearTimeout(timer)
  timer = null
}

function reset(): void {
  clearTimer()
  pending.value = false
}

function ask(): void {
  if (props.disabled) return
  pending.value = true
  clearTimer()
  timer = setTimeout(() => {
    pending.value = false
    timer = null
  }, 5000)
}

function confirm(): void {
  reset()
  emit('confirm')
}

onBeforeUnmount(clearTimer)
</script>

<template>
  <span class="confirm-button">
    <template v-if="pending">
      <button
        class="confirm-yes"
        :class="confirmClass"
        type="button"
        :data-testid="testid ? `${testid}-confirm` : undefined"
        @click.stop="confirm"
      >
        {{ confirmText }}
      </button>
      <button
        class="confirm-no"
        :class="buttonClass"
        type="button"
        :data-testid="testid ? `${testid}-cancel` : undefined"
        @click.stop="reset"
      >
        取消
      </button>
    </template>
    <button
      v-else
      :class="buttonClass"
      type="button"
      :disabled="disabled"
      :title="title"
      :data-testid="testid"
      @click.stop="ask"
    >
      {{ label }}
    </button>
  </span>
</template>

<style scoped>
.confirm-button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
</style>
