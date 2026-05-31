<template>
  <div class="space-y-0">
    <!-- Comment list -->
    <div v-for="comment in comments" :key="comment.id" class="flex gap-3 py-3 group">
      <PersonAvatar :name="comment.author_name" :uid="comment.author_uid" size="sm" />
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="text-sm font-semibold text-gray-900 dark:text-gray-100">{{ comment.author_name }}</span>
          <time class="text-xs text-gray-400 dark:text-gray-500" :title="new Date(comment.created_at).toLocaleString()">
            {{ formatTime(comment.created_at) }}
          </time>
          <span v-if="comment.edited_at" class="text-xs text-gray-400">(edited)</span>
        </div>
        <div class="text-[15px] text-gray-700 dark:text-gray-300 mt-0.5 leading-snug">
          <MarkdownRenderer :content="comment.body" />
        </div>
        <button
          v-if="canDelete(comment)"
          @click="$emit('delete', comment.id)"
          class="text-xs text-gray-400 hover:text-red-500 transition-colors cursor-pointer mt-1 opacity-0 group-hover:opacity-100"
        >
          Delete
        </button>
      </div>
    </div>

    <!-- Empty state -->
    <p v-if="comments.length === 0" class="text-sm text-gray-400 dark:text-gray-500 text-center py-6">
      No replies yet. Start the conversation.
    </p>

    <!-- Add comment input -->
    <div class="flex items-center gap-3 pt-3 border-t border-gray-100 dark:border-gray-800">
      <PersonAvatar :name="userName" :uid="userUid" size="sm" />
      <div class="flex-1 relative">
        <input
          v-model="newComment"
          type="text"
          placeholder="Post your reply..."
          class="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 outline-none focus:border-primary-300 dark:focus:border-primary-600 focus:ring-2 focus:ring-primary-100 dark:focus:ring-primary-900/30 transition-all"
          @keydown.enter="handleSubmit"
        />
      </div>
      <button
        @click="handleSubmit"
        :disabled="!newComment.trim()"
        class="px-4 py-2 text-sm font-semibold rounded-full transition-all cursor-pointer"
        :class="newComment.trim()
          ? 'bg-primary-600 text-white hover:bg-primary-700 active:scale-95'
          : 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed'"
      >
        Reply
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import PersonAvatar from './PersonAvatar.vue'
import MarkdownRenderer from './MarkdownRenderer.vue'
import { useAuth } from '@shared/client/composables/useAuth'

const props = defineProps({
  comments: { type: Array, default: () => [] },
  currentUserUid: { type: String, default: '' },
  isAdmin: { type: Boolean, default: false }
})

const emit = defineEmits(['submit', 'delete'])

const { user } = useAuth()
const newComment = ref('')
const userName = ref('You')
const userUid = ref('')

onMounted(() => {
  if (user.value) {
    userName.value = user.value.name || user.value.email || 'You'
    userUid.value = user.value.uid || user.value.email || ''
  }
})

function canDelete(comment) {
  return comment.author_uid === (props.currentUserUid || userUid.value) || props.isAdmin
}

function formatTime(dateStr) {
  const now = Date.now()
  const created = new Date(dateStr).getTime()
  const diff = now - created
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function handleSubmit() {
  const body = newComment.value.trim()
  if (!body) return
  emit('submit', body)
  newComment.value = ''
}
</script>
