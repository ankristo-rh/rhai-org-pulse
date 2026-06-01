<template>
  <div class="divide-y divide-gray-100 dark:divide-gray-800">
    <div v-for="i in count" :key="i" class="px-4 py-4">
      <div class="flex gap-3">
        <div class="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-800 shimmer shrink-0"></div>
        <div class="flex-1">
          <div class="flex items-center gap-2 mb-2">
            <div class="h-4 w-28 bg-gray-100 dark:bg-gray-800 rounded shimmer"></div>
            <div class="h-3 w-16 bg-gray-50 dark:bg-gray-800/50 rounded shimmer"></div>
          </div>
          <div class="space-y-1.5 mb-3">
            <div class="h-3.5 bg-gray-100 dark:bg-gray-800 rounded shimmer w-full"></div>
            <div class="h-3.5 bg-gray-100 dark:bg-gray-800 rounded shimmer w-4/5"></div>
            <div class="h-3.5 bg-gray-50 dark:bg-gray-800/50 rounded shimmer w-2/3"></div>
          </div>
          <div class="flex items-center gap-4 pt-3 border-t border-gray-50 dark:border-gray-800">
            <div class="h-4 w-8 bg-gray-50 dark:bg-gray-800/50 rounded shimmer"></div>
            <div class="h-4 w-8 bg-gray-50 dark:bg-gray-800/50 rounded shimmer"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  count: { type: Number, default: 3 }
})
</script>

<style scoped>
.shimmer {
  animation: shimmer 1.5s infinite;
  background-size: 200% 100%;
  background-image: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.15) 50%, transparent 100%);
}
:root.dark .shimmer {
  background-image: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.05) 50%, transparent 100%);
}
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
</style>
