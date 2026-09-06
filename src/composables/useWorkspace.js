import { computed, ref, watch } from 'vue'
import { i18n, formatNumber } from '../i18n/index.js'
import { preferences } from './usePreferences.js'
import { oss, desktop } from '../services/oss.js'

export const formatSize = (bytes) => {
  if (!bytes) return '—'
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3)
  return `${formatNumber(bytes / 1024 ** i, { minimumFractionDigits: i ? 1 : 0, maximumFractionDigits: i ? 1 : 0 })} ${['B', 'KB', 'MB', 'GB'][i]}`
}
export const fileName = (item) => item.key.replace(/\/$/, '').split('/').pop()
export const fileKind = (item) =>
  item.isFolder ? 'folder' : item.key.split('.').pop().toLowerCase()
export const fileIcon = (item) =>
  ({
    folder: 'folder',
    pdf: 'file-pdf-box',
    svg: 'image-outline',
    png: 'image-outline',
    jpg: 'image-outline',
    jpeg: 'image-outline',
    webp: 'image-outline',
    json: 'code-json',
    md: 'text-box-outline',
    zip: 'folder-zip-outline',
    html: 'language-html5',
    txt: 'text-box-outline',
  })[fileKind(item)] || 'file-outline'
export function useWorkspace(api = oss) {
  const uploadRuntime = new Map()
  const mode = ref('disconnected'),
    buckets = ref([]),
    bucket = ref(null),
    prefix = ref(''),
    objects = ref([])
  const view = ref('files'),
    search = ref(''),
    sort = ref('name'),
    selection = ref([]),
    focused = ref(null),
    loading = ref(false),
    busy = ref(false),
    error = ref(''),
    nextMarker = ref(''),
    transfers = ref([]),
    toast = ref(''),
    connectionName = ref(''),
    activeConnectionId = ref(null)
  function trimTransfers() {
    let completed = 0
    transfers.value = transfers.value.filter(
      (task) =>
        ['waiting', 'active', 'paused'].includes(task.status) ||
        ++completed <= preferences.historyLimit,
    )
  }
  watch(() => preferences.historyLimit, trimTransfers)
  const starred = ref([])
  try {
    const saved = JSON.parse(localStorage.getItem('oss-neo-stars') || '[]')
    starred.value = Array.isArray(saved) ? saved.filter((s) => typeof s === 'string') : []
  } catch {
    /* Broken preferences are safe to reset. */
  }
  watch(
    starred,
    (value) => {
      try {
        localStorage.setItem('oss-neo-stars', JSON.stringify(value))
      } catch {
        /* Storage may be unavailable in private browsing. */
      }
    },
    { deep: true },
  )
  const starId = (item) => `${mode.value}:${bucket.value.name}:${item.key}`
  const isStarred = (item) => starred.value.includes(starId(item))
  const toggleStar = (item) => {
    const id = starId(item)
    starred.value = isStarred(item) ? starred.value.filter((s) => s !== id) : [...starred.value, id]
  }
  let requestId = 0
  async function refresh(append = false) {
    const id = ++requestId
    if (!bucket.value || mode.value !== 'live') return
    loading.value = true
    error.value = ''
    if (!append) {
      selection.value = []
      focused.value = null
      objects.value = []
      nextMarker.value = ''
    }
    try {
      const result = await api.list(
        bucket.value.name,
        bucket.value.region,
        prefix.value,
        append ? nextMarker.value : '',
      )
      if (id !== requestId) return
      objects.value = append
        ? [...objects.value, ...result.objects].filter(
            (o, index, list) => list.findIndex((x) => x.key === o.key) === index,
          )
        : result.objects
      nextMarker.value = result.nextMarker || ''
    } catch (e) {
      if (id === requestId) error.value = String(e)
    } finally {
      if (id === requestId) loading.value = false
    }
  }
  const visible = computed(() =>
    objects.value
      .filter(
        (o) =>
          fileName(o).toLowerCase().includes(search.value.toLowerCase()) &&
          (view.value !== 'starred' || isStarred(o)),
      )
      .sort(
        (a, b) =>
          Number(b.isFolder) - Number(a.isFolder) ||
          (sort.value === 'size'
            ? b.size - a.size
            : sort.value === 'date'
              ? new Date(b.lastModified) - new Date(a.lastModified)
              : fileName(a).localeCompare(fileName(b), i18n.global.locale.value)),
      ),
  )
  async function changeBucket(b) {
    if (busy.value) return
    bucket.value = b
    prefix.value = ''
    search.value = ''
    view.value = 'files'
    await refresh()
  }
  async function navigate(path) {
    if (busy.value) return
    prefix.value = path
    search.value = ''
    await refresh()
  }
  function select(item) {
    focused.value = item
  }
  function toggleSelection(item) {
    selection.value = selection.value.includes(item.key)
      ? selection.value.filter((k) => k !== item.key)
      : [...selection.value, item.key]
  }
  function selectAll() {
    selection.value = visible.value.every((o) => selection.value.includes(o.key))
      ? []
      : visible.value.map((o) => o.key)
  }
  async function connect(credentials, options) {
    if (busy.value) return
    busy.value = true
    try {
      const result = await api.connect(credentials, options)
      if (!result.buckets.length) throw new Error('errors.noBuckets')
      requestId++
      search.value = ''
      transfers.value = []
      mode.value = 'live'
      buckets.value = result.buckets
      activeConnectionId.value = result.profileId || null
      connectionName.value = credentials.name || 'Alibaba Cloud'
      bucket.value = result.buckets[0]
      prefix.value = ''
      view.value = 'files'
      await refresh()
      toast.value = 'feedback.connected'
    } finally {
      busy.value = false
    }
  }
  async function disconnect() {
    if (busy.value) return
    busy.value = true
    try {
      await api.disconnect()
      requestId++
      mode.value = 'disconnected'
      buckets.value = []
      bucket.value = null
      connectionName.value = ''
      activeConnectionId.value = null
      prefix.value = ''
      objects.value = []
      selection.value = []
      focused.value = null
      search.value = ''
      nextMarker.value = ''
      transfers.value = []
      error.value = ''
      toast.value = ''
      loading.value = false
      view.value = 'files'
    } catch (e) {
      toast.value = String(e)
    } finally {
      busy.value = false
    }
  }

  async function createFolder(name) {
    if (!bucket.value) throw new Error('errors.notConnected')
    if (busy.value) return
    const clean = name.trim()
    if (!clean || /[/\\\x00-\x1f]/.test(clean) || ['.', '..'].includes(clean))
      throw new Error('errors.invalidFolder')
    const key = prefix.value + clean + '/'
    if (objects.value.some((o) => o.key === key)) throw new Error('errors.folderExists')
    busy.value = true
    try {
      await api.folder(bucket.value.name, bucket.value.region, key)
      await refresh()
      toast.value = { key: 'feedback.folderCreated', params: { name: clean } }
    } finally {
      busy.value = false
    }
  }
  async function upload(files) {
    if (!files.length || !bucket.value) return
    const targetBucket = bucket.value.name,
      targetRegion = bucket.value.region,
      targetPrefix = prefix.value
    const queued = []
    for (const file of files) {
      const task = {
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        loaded: 0,
        progress: 0,
        speed: 0,
        direction: 'upload',
        status: 'waiting',
        bucket: targetBucket,
        region: targetRegion,
        key: targetPrefix + file.name,
        error: '',
      }
      transfers.value.unshift(task)
      uploadRuntime.set(task.id, { wake: null, uploadId: '' })
      queued.push({ task, file })
    }
    for (const { task, file } of queued) {
      const runtime = uploadRuntime.get(task.id)
      if (!runtime) continue
      if (task.status === 'cancelled') {
        uploadRuntime.delete(task.id)
        continue
      }
      try {
        if (file.size > 100 * 1024 * 1024) throw new Error('errors.fileLimit')
        task.status = 'active'
        const started = performance.now()
        let sampledAt = started
        let sampledBytes = 0
        if (file.size > 0 && api.startUpload && api.uploadPart && api.completeUpload) {
          runtime.uploadId = await api.startUpload(task.bucket, task.region, task.key, file.type)
          const parts = []
          const partSize = 1024 * 1024
          for (let offset = 0, partNumber = 1; offset < file.size; partNumber++) {
            while (task.status === 'paused')
              await new Promise((resolve) => {
                runtime.wake = resolve
              })
            if (task.status === 'cancelled') break
            const end = Math.min(offset + partSize, file.size)
            const etag = await api.uploadPart(
              task.bucket,
              task.region,
              task.key,
              runtime.uploadId,
              partNumber,
              file.slice(offset, end),
            )
            parts.push({ partNumber, etag })
            offset = end
            const now = performance.now()
            task.loaded = offset
            task.progress = file.size ? Math.round((offset / file.size) * 1000) / 10 : 100
            task.speed = Math.round(((offset - sampledBytes) * 1000) / Math.max(now - sampledAt, 1))
            sampledAt = now
            sampledBytes = offset
          }
          if (task.status !== 'cancelled') {
            await api.completeUpload(task.bucket, task.region, task.key, runtime.uploadId, parts)
          }
        } else {
          await api.upload(task.bucket, task.region, task.key, file)
          task.loaded = file.size
          task.progress = 100
          task.speed = Math.round((file.size * 1000) / Math.max(performance.now() - started, 1))
        }
        if (task.status !== 'cancelled') {
          task.loaded = file.size
          task.progress = 100
          task.speed = 0
          task.status = 'done'
        }
      } catch (e) {
        if (task.status !== 'cancelled') {
          task.status = 'error'
          task.error = String(e)
        }
      } finally {
        if (['cancelled', 'error'].includes(task.status) && runtime.uploadId && api.abortUpload) {
          try {
            await api.abortUpload(task.bucket, task.region, task.key, runtime.uploadId)
          } catch {
            /* Cancellation already won; OSS may have removed the multipart upload. */
          }
        }
        uploadRuntime.delete(task.id)
      }
    }
    if (bucket.value?.name === targetBucket && prefix.value === targetPrefix) await refresh()
    trimTransfers()
    toast.value = 'feedback.uploadProcessed'
  }
  function pauseUpload(id) {
    const task = transfers.value.find((item) => item.id === id)
    if (task?.status === 'active') task.status = 'paused'
  }
  function resumeUpload(id) {
    const task = transfers.value.find((item) => item.id === id)
    const runtime = uploadRuntime.get(id)
    if (task?.status !== 'paused' || !runtime) return
    task.status = 'active'
    runtime.wake?.()
    runtime.wake = null
  }
  function cancelUpload(id) {
    const task = transfers.value.find((item) => item.id === id)
    const runtime = uploadRuntime.get(id)
    if (!task || !['waiting', 'active', 'paused'].includes(task.status)) return
    task.status = 'cancelled'
    task.speed = 0
    runtime?.wake?.()
    if (runtime) runtime.wake = null
  }
  async function showTransfer(task) {
    if (task.direction !== 'upload' || task.status !== 'done') return null
    const target = buckets.value.find((item) => item.name === task.bucket)
    if (!target) return null
    if (bucket.value?.name !== target.name) await changeBucket(target)
    const slash = task.key.lastIndexOf('/')
    const parent = slash < 0 ? '' : task.key.slice(0, slash + 1)
    if (prefix.value !== parent) await navigate(parent)
    else await refresh()
    view.value = 'files'
    search.value = ''
    const item = objects.value.find((object) => object.key === task.key) || null
    if (item) {
      focused.value = item
      selection.value = [item.key]
    }
    return item
  }
  const createSignedUrl = (item, expiresSeconds) =>
    api.signedUrl(bucket.value.name, bucket.value.region, item.key, expiresSeconds)
  async function copyObject(item, targetKey, move = false) {
    if (!bucket.value || item.isFolder || busy.value) return
    const clean = targetKey.trim().replace(/^\/+/, '')
    if (
      !clean ||
      clean.endsWith('/') ||
      clean === item.key ||
      /[\x00-\x1f]/.test(clean) ||
      clean.split('/').some((part) => part === '.' || part === '..')
    )
      throw new Error('errors.invalidCopyTarget')
    busy.value = true
    try {
      await api.copyObject(bucket.value.name, bucket.value.region, item.key, clean, move)
      await refresh()
      toast.value = { key: move ? 'feedback.moved' : 'feedback.copied', params: { name: clean } }
    } finally {
      busy.value = false
    }
  }
  async function mutateObject(operation, feedback) {
    if (!bucket.value || busy.value) return
    busy.value = true
    try {
      await operation(bucket.value.name, bucket.value.region)
      await refresh()
      toast.value = feedback
    } finally {
      busy.value = false
    }
  }
  const setObjectAcl = (item, acl) =>
    mutateObject(
      (bucketName, region) => api.setAcl(bucketName, region, item.key, acl),
      'feedback.aclUpdated',
    )
  const getObjectHeaders = (item) =>
    api.getHeaders(bucket.value.name, bucket.value.region, item.key)
  const setObjectHeaders = (item, headers) =>
    mutateObject(
      (bucketName, region) => api.setHeaders(bucketName, region, item.key, headers),
      'feedback.headersUpdated',
    )
  const restoreObject = (item, days) =>
    mutateObject(
      (bucketName, region) => api.restore(bucketName, region, item.key, days),
      'feedback.restoreRequested',
    )
  async function createObjectSymlink(item, symlinkKey) {
    const clean = symlinkKey.trim().replace(/^\/+/, '')
    if (
      !clean ||
      clean.endsWith('/') ||
      clean === item.key ||
      /[\x00-\x1f]/.test(clean) ||
      clean.split('/').some((part) => part === '.' || part === '..')
    )
      throw new Error('errors.invalidSymlink')
    return mutateObject(
      (bucketName, region) => api.createSymlink(bucketName, region, item.key, clean),
      { key: 'feedback.symlinkCreated', params: { name: clean } },
    )
  }
  async function download(item) {
    if (item.isFolder || busy.value || !bucket.value) return
    busy.value = true
    const task = {
      id: crypto.randomUUID(),
      name: fileName(item),
      size: item.size,
      direction: 'download',
      status: 'active',
      bucket: bucket.value.name,
    }
    transfers.value.unshift(task)
    const stored = transfers.value[0]
    try {
      const saved = await api.download(bucket.value.name, bucket.value.region, item.key)
      stored.status = saved ? 'done' : 'cancelled'
      if (stored.status === 'done')
        toast.value = { key: 'feedback.downloaded', params: { name: fileName(item) } }
    } catch (e) {
      stored.status = 'error'
      stored.error = String(e)
      toast.value = String(e)
    } finally {
      busy.value = false
      trimTransfers()
    }
  }
  async function removeSelected() {
    if (busy.value || !bucket.value) return
    busy.value = true
    let count = 0
    try {
      for (const key of [...selection.value]) {
        await api.remove(bucket.value.name, bucket.value.region, key)
        count++
      }
    } finally {
      busy.value = false
      await refresh()
      if (count) toast.value = { key: 'feedback.deleted', params: { count } }
    }
  }
  return {
    mode,
    buckets,
    bucket,
    prefix,
    objects,
    view,
    search,
    sort,
    selection,
    focused,
    loading,
    busy,
    error,
    nextMarker,
    transfers,
    toast,
    connectionName,
    activeConnectionId,
    visible,
    isStarred,
    toggleStar,
    refresh,
    changeBucket,
    navigate,
    select,
    toggleSelection,
    selectAll,
    connect,
    disconnect,
    createFolder,
    upload,
    pauseUpload,
    resumeUpload,
    cancelUpload,
    showTransfer,
    createSignedUrl,
    copyObject,
    setObjectAcl,
    getObjectHeaders,
    setObjectHeaders,
    restoreObject,
    createObjectSymlink,
    download,
    removeSelected,
    desktop,
  }
}
