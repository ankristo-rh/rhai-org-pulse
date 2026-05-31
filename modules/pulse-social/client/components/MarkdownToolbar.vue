<template>
  <div class="flex items-center gap-1">
    <button
      v-for="btn in buttons"
      :key="btn.action"
      @click="$emit('action', btn.action)"
      class="w-8 h-8 flex items-center justify-center rounded-md text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors cursor-pointer"
      :title="btn.tooltip"
      :aria-label="btn.tooltip"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" v-html="btn.path"></svg>
    </button>
  </div>
</template>

<script setup>
defineEmits(['action'])

const buttons = [
  { action: 'bold', tooltip: 'Bold (Ctrl+B)', path: '<path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"></path><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"></path>' },
  { action: 'link', tooltip: 'Link (Ctrl+K)', path: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>' },
  { action: 'code', tooltip: 'Code', path: '<polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline>' },
  { action: 'image', tooltip: 'Image', path: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline>' },
]
</script>
