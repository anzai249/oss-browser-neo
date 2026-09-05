import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useImagePreview, MAX_PREVIEW_BYTES } from '../src/composables/useImagePreview.js'

const target = {
  bucket: 'test-bucket',
  region: 'cn-hangzhou',
  key: 'photo.PNG',
  size: 12,
  storageClass: 'Standard',
}
function setup() {
  const scheduled = new Map(),
    requests = [],
    cancelled = [],
    revoked = [],
    blobs = []
  let timer = 0
  const preview = useImagePreview({
    api: {
      preview: (...args) =>
        new Promise((resolve, reject) => requests.push({ args, resolve, reject })),
      cancelPreview: async (id) => cancelled.push(id),
    },
    urls: {
      createObjectURL: (blob) => {
        blobs.push(blob)
        return `blob:test-${blobs.length}`
      },
      revokeObjectURL: (url) => revoked.push(url),
    },
    schedule: (callback) => {
      scheduled.set(++timer, callback)
      return timer
    },
    unschedule: (timer) => scheduled.delete(timer),
  })
  const start = () => {
    const [id, callback] = [...scheduled.entries()].at(-1)
    scheduled.delete(id)
    return callback()
  }
  return { preview, requests, cancelled, revoked, blobs, scheduled, start }
}

test('disabled, unsupported, oversized and archived objects never cause an OSS request', () => {
  const s = setup()
  for (const [object, enabled, status] of [
    [target, false, 'disabled'],
    [{ ...target, key: 'doc.pdf' }, true, 'idle'],
    [{ ...target, size: MAX_PREVIEW_BYTES + 1 }, true, 'tooLarge'],
    [{ ...target, storageClass: 'Archive' }, true, 'archived'],
  ]) {
    s.preview.load(object, enabled)
    assert.equal(s.preview.status.value, status)
    assert.equal(s.scheduled.size, 0)
  }
  assert.equal(s.requests.length, 0)
})

test('debounces selection, preserves private bytes and releases image URLs', async () => {
  const s = setup()
  s.preview.load(target)
  s.preview.load({ ...target, key: 'latest.jpg' })
  assert.equal(s.scheduled.size, 1)
  const pending = s.start()
  assert.deepEqual(s.requests[0].args.slice(0, 3), ['test-bucket', 'cn-hangzhou', 'latest.jpg'])
  s.requests[0].resolve(new Uint8Array([1, 2, 3]).buffer)
  await pending
  assert.equal(s.blobs[0].type, 'image/jpeg')
  assert.equal(s.blobs[0].size, 3)
  s.preview.loaded(s.preview.url.value)
  assert.equal(s.preview.status.value, 'ready')
  s.preview.dispose()
  assert.deepEqual(s.revoked, ['blob:test-1'])
  assert.equal(s.preview.url.value, '')
})

test('switching selection cancels the old read and ignores out-of-order completion', async () => {
  const s = setup()
  s.preview.load(target)
  const old = s.start()
  s.preview.load({ ...target, key: 'new.png' })
  const latest = s.start()
  assert.ok(s.cancelled[0] > s.requests[0].args[3])
  assert.ok(s.requests[1].args[3] >= s.cancelled[0])
  s.requests[1].resolve(new Uint8Array([2]).buffer)
  await latest
  s.requests[0].resolve(new Uint8Array([1]).buffer)
  await old
  assert.equal(s.blobs.length, 1)
  assert.deepEqual([...new Uint8Array(await s.blobs[0].arrayBuffer())], [2])
})

test('turning off preview cancels in-flight reads and prevents stale errors and images', async () => {
  const s = setup()
  s.preview.load(target)
  const pending = s.start()
  s.preview.load(target, false)
  assert.equal(s.cancelled.length, 1)
  s.requests[0].reject(Error('cancelled'))
  await pending
  assert.equal(s.preview.status.value, 'disabled')
  assert.equal(s.preview.error.value, '')
  assert.equal(s.blobs.length, 0)
})

test('read and decode failures are visible and can be retried', async () => {
  const s = setup()
  s.preview.load(target)
  let pending = s.start()
  s.requests[0].reject(Error('errors.network'))
  await pending
  assert.match(s.preview.error.value, /network/)
  s.preview.load(target)
  pending = s.start()
  s.requests[1].resolve(new ArrayBuffer(2))
  await pending
  s.preview.failed('blob:obsolete')
  assert.equal(s.preview.url.value, 'blob:test-1')
  s.preview.failed(s.preview.url.value)
  assert.equal(s.preview.status.value, 'error')
  assert.equal(s.preview.error.value, 'errors.previewDecode')
  assert.deepEqual(s.revoked, ['blob:test-1'])
})
