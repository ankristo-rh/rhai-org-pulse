<template>
  <div class="flex items-center gap-3 py-5 px-5">
    <div class="flex-1 h-px bg-gray-200 dark:bg-gray-700"></div>
    <span class="text-xs font-medium text-gray-400 dark:text-gray-500 select-none">
      {{ label }}
    </span>
    <div class="flex-1 h-px bg-gray-200 dark:bg-gray-700"></div>
  </div>
</template>

<script setup>
defineProps({
  label: { type: String, required: true }
})
</script>
