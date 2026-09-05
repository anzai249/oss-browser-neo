import { ref } from 'vue'
import { oss } from '../services/oss.js'

export const MAX_PREVIEW_BYTES = 10 * 1024 * 1024
const mimeTypes = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
}
export const imageMime = (key = '') => mimeTypes[key.split('.').pop().toLowerCase()]
let sequence = Date.now() * 1000

export function useImagePreview({
  api = oss,
  urls = URL,
  schedule = setTimeout,
  unschedule = clearTimeout,
} = {}) {
  const url = ref(''),
    status = ref('idle'),
    error = ref('')
  let generation = 0,
    pending = false,
    timer
  function invalidate() {
    generation = ++sequence
    unschedule(timer)
    if (pending) void api.cancelPreview(generation).catch(() => {})
    pending = false
    if (url.value) urls.revokeObjectURL(url.value)
    url.value = ''
    error.value = ''
    status.value = 'idle'
  }
  function load(target, enabled = true) {
    invalidate()
    if (!target || !imageMime(target.key) || target.isFolder) return
    if (!enabled) {
      status.value = 'disabled'
      return
    }
    if (['Archive', 'ColdArchive', 'DeepColdArchive'].includes(target.storageClass)) {
      status.value = 'archived'
      return
    }
    if (target.size > MAX_PREVIEW_BYTES) {
      status.value = 'tooLarge'
      return
    }
    const current = generation
    status.value = 'loading'
    timer = schedule(async () => {
      if (current !== generation) return
      pending = true
      try {
        const bytes = await api.preview(target.bucket, target.region, target.key, current)
        if (current !== generation) return
        const blob = new Blob([bytes], { type: imageMime(target.key) })
        if (blob.size > MAX_PREVIEW_BYTES) {
          status.value = 'tooLarge'
          return
        }
        url.value = urls.createObjectURL(blob)
      } catch (e) {
        if (current === generation) {
          status.value = 'error'
          error.value = String(e)
        }
      } finally {
        if (current === generation) pending = false
      }
    }, 180)
  }
  function loaded(source) {
    if (source === url.value) status.value = 'ready'
  }
  function failed(source) {
    if (source !== url.value) return
    urls.revokeObjectURL(url.value)
    url.value = ''
    status.value = 'error'
    error.value = 'errors.previewDecode'
  }
  return { url, status, error, load, loaded, failed, dispose: invalidate }
}
