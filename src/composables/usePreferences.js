import { reactive, ref, watch } from 'vue'

export const PREFERENCES_KEY = 'oss-neo-preferences'
export const preferenceOptions = {
  theme: ['system', 'light', 'dark'],
  pageSize: [100, 200, 500, 1000],
  timeoutSeconds: [30, 60, 120, 300, 600],
  readRetries: [0, 1, 2, 3],
  historyLimit: [50, 100, 200, 500],
}
export const preferenceDefaults = Object.freeze({
  theme: 'system',
  imagePreview: true,
  pageSize: 100,
  timeoutSeconds: 300,
  readRetries: 1,
  historyLimit: 100,
})
export function sanitizePreferences(value) {
  const result = { ...preferenceDefaults }
  if (!value || typeof value !== 'object') return result
  if (typeof value.imagePreview === 'boolean') result.imagePreview = value.imagePreview
  for (const [key, options] of Object.entries(preferenceOptions)) {
    if (options.includes(value[key])) result[key] = value[key]
  }
  return result
}
export function createPreferences(storage) {
  let initial
  const storageError = ref(false)
  try {
    initial = JSON.parse(storage?.getItem(PREFERENCES_KEY) || '{}')
  } catch {
    /* Invalid preferences fall back to defaults. */
  }
  const preferences = reactive(sanitizePreferences(initial))
  watch(
    preferences,
    (value) => {
      try {
        if (!storage) throw Error('unavailable')
        storage.setItem(PREFERENCES_KEY, JSON.stringify(sanitizePreferences(value)))
        storageError.value = false
      } catch {
        storageError.value = true
      }
    },
    { flush: 'sync' },
  )
  const resetPreferences = () => Object.assign(preferences, preferenceDefaults)
  return { preferences, storageError, resetPreferences }
}
let storage
try {
  storage = globalThis.localStorage
} catch {
  /* Session-only settings. */
}
export const { preferences, storageError, resetPreferences } = createPreferences(storage)
