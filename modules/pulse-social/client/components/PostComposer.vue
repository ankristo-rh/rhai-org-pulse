<template>
  <div ref="composerRef" class="px-5 py-5 border-b border-gray-100 dark:border-gray-700/50">
    <!-- Collapsed: single row prompt -->
    <div
      v-if="!isExpanded"
      @click="expand"
      class="flex items-center gap-3 cursor-pointer group"
      role="button"
      aria-expanded="false"
      aria-label="Open post composer"
    >
      <PersonAvatar :name="userName" :uid="userUid" size="md" />
      <span class="flex-1 text-[15px] text-gray-400 dark:text-gray-500 group-hover:text-gray-500 dark:group-hover:text-gray-400 transition-colors">{{ composer.placeholder.value }}</span>
      <span class="px-4 py-1.5 text-sm font-semibold text-primary-600 dark:text-primary-400 border border-primary-200 dark:border-primary-800 rounded-full hover:bg-primary-50 dark:hover:bg-primary-900/20 transition-colors">Post</span>
    </div>

    <!-- Expanded -->
    <div v-else class="flex gap-3">
      <PersonAvatar :name="userName" :uid="userUid" size="md" class="shrink-0 mt-1" />
      <div class="flex-1 min-w-0">
        <!-- Textarea -->
        <textarea
          ref="textareaRef"
          v-model="composer.body.value"
          :placeholder="composer.placeholder.value"
          class="w-full resize-none bg-transparent text-[15px] text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 outline-none leading-relaxed min-h-[80px]"
          @input="autoGrow"
          @keydown="handleKeydown"
          @paste="handlePaste"
        ></textarea>

        <!-- Uploaded files -->
        <div v-if="attachedFiles.length > 0" class="mt-2 space-y-1.5">
          <div
            v-for="(file, index) in attachedFiles"
            :key="index"
            class="flex items-center gap-2 text-sm bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2 border border-gray-100 dark:border-gray-700"
          >
            <span class="text-gray-400">{{ file.type?.startsWith('image/') ? '🖼' : '📎' }}</span>
            <span class="text-gray-700 dark:text-gray-300 truncate flex-1">{{ file.name }}</span>
            <span class="text-xs text-gray-400">{{ formatSize(file.size) }}</span>
            <button @click="removeFile(index)" class="text-gray-400 hover:text-red-500 cursor-pointer" aria-label="Remove file">✕</button>
          </div>
        </div>

        <!-- Upload progress -->
        <div v-if="uploading" class="mt-2 flex items-center gap-2 text-xs text-gray-500">
          <span class="w-3 h-3 border-2 border-gray-300 border-t-primary-600 rounded-full animate-spin"></span>
          Uploading...
        </div>

        <!-- Divider + actions -->
        <div class="mt-3 border-t border-gray-100 dark:border-gray-800 pt-3">
          <!-- Label chips -->
          <div v-if="composer.body.value.trim().length > 0" class="flex flex-wrap items-center gap-1.5 mb-3 animate-fadeIn">
            <button
              v-for="l in labelOptions"
              :key="l.key"
              @click="handleLabelSelect(l.key)"
              class="px-2.5 py-1 text-xs font-medium rounded-full border transition-all cursor-pointer"
              :class="composer.label.value === l.key
                ? l.activeClass
                : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'"
            >
              {{ l.icon }} {{ l.label }}
            </button>
          </div>

          <!-- Bottom bar: toolbar + submit -->
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-1">
              <MarkdownToolbar @action="handleToolbarAction" />
              <div class="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-1"></div>
              <button
                @click="triggerFileInput"
                class="w-8 h-8 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors cursor-pointer"
                title="Attach file"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
              </button>
              <input
                ref="fileInputRef"
                type="file"
                class="hidden"
                accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.txt,.md"
                multiple
                @change="handleFileSelect"
              />
            </div>

            <div class="flex items-center gap-2">
              <span v-if="composer.error.value" class="text-xs text-red-500">{{ composer.error.value }}</span>
              <button
                @click="collapse"
                class="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 cursor-pointer"
              >
                Cancel
              </button>
              <button
                @click="handleSubmit"
                :disabled="!composer.canSubmit.value || uploading"
                class="px-5 py-2 text-sm font-semibold rounded-full transition-all cursor-pointer"
                :class="composer.canSubmit.value && !uploading
                  ? 'bg-primary-600 text-white hover:bg-primary-700 shadow-sm hover:shadow active:scale-95'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-400 cursor-not-allowed'"
              >
                <span v-if="composer.submitting.value" class="flex items-center gap-1.5">
                  <span class="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                  Posting
                </span>
                <span v-else>Post</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick, onMounted, onBeforeUnmount } from 'vue'
import PersonAvatar from './PersonAvatar.vue'
import MarkdownToolbar from './MarkdownToolbar.vue'
import { useComposer } from '../composables/useComposer'
import { useAuth } from '@shared/client/composables/useAuth'
import { getApiBase } from '@shared/client/services/api'

const emit = defineEmits(['posted'])

const composer = useComposer()
const { user } = useAuth()

const isExpanded = ref(false)
const composerRef = ref(null)
const textareaRef = ref(null)
const fileInputRef = ref(null)
const attachedFiles = ref([])
const uploading = ref(false)
let expandedAt = 0

const userName = ref('You')
const userUid = ref('')

const labelOptions = [
  { key: 'win', label: 'Win', icon: '🏆', activeClass: 'bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700' },
  { key: 'til', label: 'TIL', icon: '💡', activeClass: 'bg-purple-50 text-purple-700 border-purple-300 dark:bg-purple-900/30 dark:text-purple-400 dark:border-purple-700' },
  { key: 'customer-success', label: 'Customer', icon: '🤝', activeClass: 'bg-green-50 text-green-700 border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700' },
  { key: 'question', label: 'Question', icon: '❓', activeClass: 'bg-orange-50 text-orange-700 border-orange-300 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-700' },
  { key: 'milestone', label: 'Milestone', icon: '🎯', activeClass: 'bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-700' },
]

function normalizeReactions(reactions) {
  if (!reactions || typeof reactions !== 'object') return {}
  const normalized = {}
  for (const [emoji, value] of Object.entries(reactions)) {
    normalized[emoji] = Array.isArray(value) ? value.length : value
  }
  return normalized
}

onMounted(() => {
  if (user.value) {
    userName.value = user.value.name || user.value.email || 'You'
    userUid.value = user.value.uid || user.value.email || ''
  }
  document.addEventListener('click', handleClickOutside)
  document.addEventListener('keydown', handleEscape)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside)
  document.removeEventListener('keydown', handleEscape)
})

function expand() {
  isExpanded.value = true
  expandedAt = Date.now()
  nextTick(() => { textareaRef.value?.focus() })
}

function collapse() {
  isExpanded.value = false
  attachedFiles.value = []
  composer.reset()
}

function handleClickOutside(e) {
  if (!isExpanded.value) return
  if (Date.now() - expandedAt < 200) return
  if (composer.body.value.trim().length > 0 || attachedFiles.value.length > 0) return
  if (composerRef.value && !composerRef.value.contains(e.target)) {
    collapse()
  }
}

function handleEscape(e) {
  if (e.key === 'Escape' && isExpanded.value && composer.body.value.trim().length === 0 && attachedFiles.value.length === 0) {
    collapse()
  }
}

function autoGrow() {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}

function handleLabelSelect(label) {
  composer.selectLabel(label)
}

function handleToolbarAction(action) {
  if (action === 'image') {
    fileInputRef.value?.click()
    return
  }

  const el = textareaRef.value
  if (!el) return

  const start = el.selectionStart
  const end = el.selectionEnd
  const text = composer.body.value
  const selected = text.slice(start, end)

  let insert, cursorOffset

  switch (action) {
    case 'bold':
      insert = selected ? `**${selected}**` : '**bold**'
      cursorOffset = selected ? insert.length : 2
      break
    case 'link':
      insert = selected ? `[${selected}](url)` : '[text](url)'
      cursorOffset = selected ? insert.length - 1 : 1
      break
    case 'code':
      insert = selected ? `\`${selected}\`` : '`code`'
      cursorOffset = selected ? insert.length : 1
      break
    default:
      return
  }

  composer.body.value = text.slice(0, start) + insert + text.slice(end)
  nextTick(() => {
    el.focus()
    const newPos = start + cursorOffset
    el.setSelectionRange(newPos, newPos)
    autoGrow()
  })
}

function handleKeydown(e) {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
    switch (e.key.toLowerCase()) {
      case 'b': e.preventDefault(); handleToolbarAction('bold'); break
      case 'k': e.preventDefault(); handleToolbarAction('link'); break
      case 'enter': e.preventDefault(); handleSubmit(); break
    }
  }
}

function triggerFileInput() { fileInputRef.value?.click() }

function handleFileSelect(e) {
  addFiles(Array.from(e.target.files))
  e.target.value = ''
}

function handlePaste(e) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      const file = item.getAsFile()
      if (file) addFiles([file])
      return
    }
  }
}

function addFiles(files) {
  for (const f of files) {
    if (attachedFiles.value.length >= 5) break
    if (f.size > 10 * 1024 * 1024) {
      composer.error.value = `${f.name} exceeds 10MB`
      continue
    }
    attachedFiles.value.push(f)
  }
}

function removeFile(index) {
  attachedFiles.value.splice(index, 1)
  composer.error.value = null
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + 'KB'
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB'
}

async function uploadFiles(postId) {
  for (const file of attachedFiles.value) {
    try {
      const buf = await file.arrayBuffer()
      const resp = await fetch(`${getApiBase()}/modules/pulse-social/attachments`, {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-Filename': encodeURIComponent(file.name),
          'X-Post-Id': postId
        },
        body: buf
      })
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}))
        composer.error.value = errData.error || `Upload failed (${resp.status})`
      }
    } catch (err) {
      composer.error.value = 'Upload failed: ' + err.message
    }
  }
}

async function handleSubmit() {
  const post = await composer.submit()
  if (!post) return

  let finalPost = post
  if (attachedFiles.value.length > 0) {
    uploading.value = true
    await uploadFiles(post.id)
    uploading.value = false
    try {
      const { apiRequest } = await import('@shared/client/services/api')
      finalPost = await apiRequest(`/modules/pulse-social/posts/${post.id}`)
    } catch {
      // Fall back to original post data
    }
  }

  finalPost = {
    ...finalPost,
    reactions: normalizeReactions(finalPost.reactions),
    comment_count: Array.isArray(finalPost.comments) ? finalPost.comments.length : (finalPost.comment_count || 0),
    reaction_count: finalPost.reaction_count || 0,
    recent_comments: finalPost.recent_comments || [],
    attachments: finalPost.attachments || []
  }

  isExpanded.value = false
  attachedFiles.value = []
  emit('posted', finalPost)
}
</script>

<style scoped>
.animate-fadeIn {
  animation: fadeIn 200ms ease-out;
}
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
