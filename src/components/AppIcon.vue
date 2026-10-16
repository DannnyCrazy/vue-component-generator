<script setup lang="ts">
/** 轻量图标组件：内置常用 SVG 路径，避免引入图标库 */
const ICONS: Record<string, string[]> = {
  gear: [
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
    'M10.3 3.3a1.7 1.7 0 0 1 3.4 0 1.7 1.7 0 0 0 2.5 1.1 1.7 1.7 0 0 1 2.4 2.4 1.7 1.7 0 0 0 1.1 2.5 1.7 1.7 0 0 1 0 3.4 1.7 1.7 0 0 0-1.1 2.5 1.7 1.7 0 0 1-2.4 2.4 1.7 1.7 0 0 0-2.5 1.1 1.7 1.7 0 0 1-3.4 0 1.7 1.7 0 0 0-2.5-1.1 1.7 1.7 0 0 1-2.4-2.4 1.7 1.7 0 0 0-1.1-2.5 1.7 1.7 0 0 1 0-3.4 1.7 1.7 0 0 0 1.1-2.5 1.7 1.7 0 0 1 2.4-2.4 1.7 1.7 0 0 0 2.5-1.1Z',
  ],
  sun: ['M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z', 'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'],
  moon: ['M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z'],
  sparkles: ['M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3Z', 'M18.5 15.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1Z'],
  play: ['M6.5 4.8l11.2 7.2-11.2 7.2V4.8Z'],
  stop: ['M7 7h10v10H7z'],
  copy: ['M9 9h10v10H9z', 'M15 5H6a1 1 0 0 0-1 1v9'],
  download: ['M12 4v11', 'M7.5 10.5 12 15l4.5-4.5', 'M5 19h14'],
  refresh: ['M20 11a8 8 0 1 0-2.3 5.7', 'M20 5v6h-6'],
  expand: ['M4 9V4h5', 'M20 15v5h-5', 'M4 4l6 6', 'M20 20l-6-6'],
  shrink: ['M9 4v5H4', 'M15 20v-5h5'],
  trash: ['M4 7h16', 'M9 7V5h6v2', 'M6 7l1 13h10l1-13'],
  plus: ['M12 5v14', 'M5 12h14'],
  code: ['M9 7 4 12l5 5', 'M15 7l5 5-5 5'],
  eye: ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'],
  history: ['M12 7v5l3 2', 'M3.5 12a8.5 8.5 0 1 0 2.6-6.1', 'M3 4v5h5'],
  check: ['M5 13l4 4L19 7'],
  alert: ['M12 8v5', 'M12 17h.01', 'M10.3 3.9 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  wand: ['M15 4V2', 'M15 22v-2', 'M8.5 8.5 3 3', 'M21 21l-5.5-5.5', 'M4 15H2', 'M22 15h-2', 'M6 6l12 12'],
  layers: ['M12 3 3 8l9 5 9-5-9-5Z', 'M3 14l9 5 9-5'],
  terminal: ['M5 8l4 4-4 4', 'M13 16h6'],
  file: ['M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-4-4Z', 'M14 3v4h4'],
  link: ['M10 13a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 11a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 19.7l1-1'],
  bolt: ['M13 2 4 14h6l-1 8 9-12h-6l1-8Z'],
}

const props = withDefaults(defineProps<{ name: keyof typeof ICONS | string; size?: number; stroke?: number }>(), {
  size: 16,
  stroke: 1.8,
})

const paths = (): string[] => ICONS[props.name] ?? ICONS.sparkles
</script>

<template>
  <svg
    :width="props.size"
    :height="props.size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="props.stroke"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path v-for="(d, index) in paths()" :key="index" :d="d" />
  </svg>
</template>
