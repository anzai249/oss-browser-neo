import { invoke, isTauri } from '@tauri-apps/api/core'
import { preferences } from '../composables/usePreferences.js'
const options = () => ({
  timeoutSeconds: preferences.timeoutSeconds,
  readRetries: preferences.readRetries,
})
export const desktop = isTauri()
export const oss = {
  connect: (credentials, { remember = false, useSaved = false, profileId = null } = {}) =>
    invoke('connect_oss', { credentials, remember, useSaved, profileId, options: options() }),
  savedConnections: () => invoke('saved_connections'),
  saveConnection: (credentials, { profileId = null, useSaved = false } = {}) =>
    invoke('save_connection', { credentials, profileId, useSaved }),
  forgetConnection: (profileId) => invoke('forget_connection', { profileId }),
  disconnect: () => invoke('disconnect_oss'),
  list: (bucket, region, prefix, marker = '') =>
    invoke('list_objects', {
      bucket,
      region,
      prefix,
      marker,
      pageSize: preferences.pageSize,
      options: options(),
    }),
  upload: async (bucket, region, key, file) =>
    invoke('put_object', {
      options: options(),
      bucket,
      region,
      key,
      data: Array.from(new Uint8Array(await file.arrayBuffer())),
      contentType: file.type || 'application/octet-stream',
    }),
  folder: (bucket, region, key) =>
    invoke('put_object', {
      bucket,
      region,
      key,
      data: [],
      contentType: 'application/x-directory',
      options: options(),
    }),
  remove: (bucket, region, key) =>
    invoke('delete_object', { bucket, region, key, options: options() }),
  preview: (bucket, region, key, generation) =>
    invoke('preview_image', { bucket, region, key, generation, options: options() }),
  cancelPreview: (generation) => invoke('cancel_preview', { generation }),
  download: (bucket, region, key) =>
    invoke('download_object', { bucket, region, key, options: options() }),
}
