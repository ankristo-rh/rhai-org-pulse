<template>
  <div
    class="rounded-full flex items-center justify-center font-semibold text-white select-none shrink-0 ring-2 ring-white dark:ring-gray-800 shadow-sm"
    :class="sizeClasses"
    :style="{ background: bgGradient }"
    :title="name"
  >
    {{ initials }}
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  name: { type: String, required: true },
  uid: { type: String, default: '' },
  size: { type: String, default: 'md' }
})

const initials = computed(() => {
  const parts = props.name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return (parts[0] || '?').slice(0, 2).toUpperCase()
})

const bgGradient = computed(() => {
  let hash = 0
  const str = props.uid || props.name
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360
  return `linear-gradient(135deg, hsl(${hue}, 55%, 48%) 0%, hsl(${(hue + 25) % 360}, 55%, 40%) 100%)`
})

const sizeClasses = computed(() => {
  switch (props.size) {
    case 'xs': return 'w-6 h-6 text-[9px]'
    case 'sm': return 'w-8 h-8 text-[11px]'
    case 'md': return 'w-10 h-10 text-sm'
    case 'lg': return 'w-11 h-11 text-sm'
    case 'xl': return 'w-14 h-14 text-base'
    default: return 'w-10 h-10 text-sm'
  }
})
</script>
