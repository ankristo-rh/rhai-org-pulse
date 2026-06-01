<template>
  <span
    v-if="label"
    class="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full"
    :class="[badgeClasses, shimmerClass]"
  >
    <span>{{ icon }}</span>
    <span>{{ displayLabel }}</span>
  </span>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  label: { type: String, default: null },
  resolved: { type: Boolean, default: false }
})

const LABEL_CONFIG = {
  'win': { display: 'Win', icon: '🏆', classes: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200/50 dark:border-amber-700/30' },
  'customer-success': { display: 'Customer', icon: '🤝', classes: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400 border border-green-200/50 dark:border-green-700/30' },
  'til': { display: 'TIL', icon: '💡', classes: 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400 border border-purple-200/50 dark:border-purple-700/30' },
  'question': { display: 'Question', icon: '❓', classes: 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 border border-orange-200/50 dark:border-orange-700/30' },
  'milestone': { display: 'Milestone', icon: '🎯', classes: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 border border-blue-200/50 dark:border-blue-700/30' }
}

const config = computed(() => LABEL_CONFIG[props.label] || null)
const badgeClasses = computed(() => config.value?.classes || '')
const icon = computed(() => config.value?.icon || '')
const shimmerClass = computed(() => {
  if (props.label === 'win' || props.label === 'milestone') return 'label-shimmer'
  return ''
})
const displayLabel = computed(() => {
  if (props.label === 'question' && props.resolved) return 'Resolved ✓'
  return config.value?.display || props.label
})
</script>

<style scoped>
.label-shimmer {
  position: relative;
  overflow: hidden;
}
.label-shimmer::after {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 50%, transparent 100%);
  animation: labelShimmer 3s ease-in-out infinite;
}
@keyframes labelShimmer {
  0%, 100% { left: -100%; }
  50% { left: 100%; }
}
</style>
