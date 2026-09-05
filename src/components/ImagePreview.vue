<script setup>
import { watch, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { preferences } from '../composables/usePreferences.js'
import { useImagePreview } from '../composables/useImagePreview.js'
import { fileIcon, fileKind, fileName } from '../composables/useWorkspace.js'
import { messageText } from '../i18n/index.js'
import Icon from './AppIcon.vue'
const props = defineProps({
  item: { type: Object, required: true },
  bucket: { type: Object, required: true },
})
const { t } = useI18n()
const { url, status, error, load, loaded, failed, dispose } = useImagePreview()
const reload = () =>
  load(
    { ...props.item, bucket: props.bucket.name, region: props.bucket.region },
    preferences.imagePreview,
  )
watch(
  () => [
    props.item.key,
    props.item.size,
    props.item.lastModified,
    props.bucket.name,
    props.bucket.region,
    preferences.imagePreview,
  ],
  reload,
  { immediate: true },
)
onUnmounted(dispose)
</script>
<template>
  <div
    class="file-preview"
    :class="{ 'image-file-preview': status !== 'idle' }"
    :aria-busy="status === 'loading'"
  >
    <img
      v-if="url"
      :key="url"
      :src="url"
      :alt="fileName(item)"
      class="object-image"
      @load="loaded($event.target.src)"
      @error="failed($event.target.src)"
    />
    <div v-if="status === 'loading'" class="preview-message" role="status">
      <v-progress-linear indeterminate color="primary" /><span>{{ t('preview.loading') }}</span>
    </div>
    <template v-else-if="status !== 'ready'">
      <span class="file-icon" :class="fileKind(item)"
        ><Icon :name="fileIcon(item)" :size="status === 'idle' ? 65 : 32"
      /></span>
      <span v-if="status === 'idle'" class="preview-type">{{
        item.isFolder ? t('files.folder') : fileKind(item).toUpperCase()
      }}</span>
      <span v-else-if="status === 'disabled'" class="preview-message">{{
        t('preview.disabled')
      }}</span>
      <span v-else-if="status === 'archived'" class="preview-message">{{
        t('preview.archived')
      }}</span>
      <span v-else-if="status === 'tooLarge'" class="preview-message">{{
        t('preview.tooLarge')
      }}</span>
      <div v-else-if="status === 'error'" class="preview-message" role="status">
        <span>{{ messageText(error) }}</span
        ><v-btn variant="text" size="small" @click="reload">{{ t('actions.retry') }}</v-btn>
      </div>
    </template>
  </div>
</template>
