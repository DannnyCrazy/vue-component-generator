<script setup lang="ts">
import { useToast } from '@/composables/useToast'
import AppIcon from '@/components/AppIcon.vue'

const { items } = useToast()
</script>

<template>
  <div class="toast-host">
    <TransitionGroup name="toast">
      <div v-for="item in items" :key="item.id" class="toast" :class="item.type">
        <AppIcon :name="item.type === 'err' ? 'alert' : item.type === 'ok' ? 'check' : 'sparkles'" :size="14" />
        <span>{{ item.text }}</span>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.22s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.97);
}
</style>
