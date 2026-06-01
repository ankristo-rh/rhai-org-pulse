<template>
  <div class="flex items-center gap-2 mt-3">
    <PersonAvatar :name="userName" :uid="userUid" size="xs" />
    <div class="flex-1 relative">
      <input
        ref="inputRef"
        v-model="text"
        type="text"
        placeholder="Write a reply..."
        class="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full px-4 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:border-primary-300 dark:focus:border-primary-600 focus:ring-2 focus:ring-primary-100 dark:focus:ring-primary-900/30 transition-all"
        @keydown.enter="submit"
      />
      <button
        v-if="text.trim()"
        @click="submit"
        class="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full bg-primary-600 text-white hover:bg-primary-700 transition-colors cursor-pointer"
        aria-label="Send"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import PersonAvatar from './PersonAvatar.vue'
import { useAuth } from '@shared/client/composables/useAuth'

const emit = defineEmits(['submit'])
const { user } = useAuth()

const text = ref('')
const inputRef = ref(null)
const userName = ref('You')
const userUid = ref('')

onMounted(() => {
  if (user.value) {
    userName.value = user.value.name || user.value.email || 'You'
    userUid.value = user.value.uid || user.value.email || ''
  }
})

function submit() {
  const body = text.value.trim()
  if (!body) return
  emit('submit', body)
  text.value = ''
}
</script>
