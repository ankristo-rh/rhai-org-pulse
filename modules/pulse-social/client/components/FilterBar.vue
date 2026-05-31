<template>
  <div class="flex items-center gap-1 overflow-x-auto scrollbar-hide border-b border-gray-100 dark:border-gray-700/50 px-4">
    <button
      @click="$emit('filter', null)"
      class="relative flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors cursor-pointer"
      :class="!active
        ? 'text-gray-900 dark:text-gray-100'
        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'"
    >
      All
      <span v-if="!active" class="absolute bottom-0 left-3 right-3 h-0.5 bg-primary-600 dark:bg-primary-400 rounded-full"></span>
    </button>
    <button
      v-for="l in labels"
      :key="l.key"
      @click="$emit('filter', l.key)"
      class="relative flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors cursor-pointer"
      :class="active === l.key
        ? 'text-gray-900 dark:text-gray-100'
        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'"
    >
      <span class="text-xs">{{ l.icon }}</span>
      <span>{{ l.display }}</span>
      <span v-if="active === l.key" class="absolute bottom-0 left-3 right-3 h-0.5 rounded-full" :class="l.indicatorColor"></span>
    </button>
  </div>
</template>

<script setup>
defineProps({
  active: { type: String, default: null }
})

defineEmits(['filter'])

const labels = [
  { key: 'win', display: 'Wins', icon: '🏆', indicatorColor: 'bg-amber-500' },
  { key: 'til', display: 'TIL', icon: '💡', indicatorColor: 'bg-purple-500' },
  { key: 'customer-success', display: 'Customer', icon: '🤝', indicatorColor: 'bg-green-500' },
  { key: 'question', display: 'Questions', icon: '❓', indicatorColor: 'bg-orange-500' },
  { key: 'milestone', display: 'Milestones', icon: '🎯', indicatorColor: 'bg-blue-500' }
]
</script>

<style scoped>
.scrollbar-hide::-webkit-scrollbar { display: none; }
.scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
</style>
