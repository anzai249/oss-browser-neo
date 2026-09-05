import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextTick } from 'vue'
import { preferences } from '../src/composables/usePreferences.js'
import { useWorkspace } from '../src/composables/useWorkspace.js'

const item = (key) => ({
  key,
  isFolder: key.endsWith('/'),
  size: 12,
  lastModified: '2026-01-01T00:00:00Z',
  storageClass: 'Standard',
})
const bucket = { name: 'test-bucket', region: 'oss-cn-hangzhou' }
const api = (overrides = {}) => ({
  connect: async () => ({ buckets: [bucket], profileId: 'test-profile' }),
  disconnect: async () => {},
  list: async () => ({ objects: [], nextMarker: '' }),
  ...overrides,
})

test('startup has no connection, files, or network calls', async () => {
  const w = useWorkspace(api({ list: () => assert.fail('must not list before connecting') }))
  await w.refresh()
  assert.equal(w.mode.value, 'disconnected')
  assert.equal(w.bucket.value, null)
  assert.equal(w.activeConnectionId.value, null)
  for (const name of ['buckets', 'objects', 'transfers', 'selection'])
    assert.deepEqual(w[name].value, [])
  await assert.rejects(w.createFolder('folder'), /errors.notConnected/)
})

test('connection forwards persistence options; failure preserves the active workspace', async () => {
  let fail = false
  const w = useWorkspace(
    api({
      connect: async (credentials, options) => {
        assert.equal(credentials.name, 'work')
        assert.deepEqual(options, { remember: true, useSaved: true })
        if (fail) throw Error('errors.persistenceWrite')
        return { buckets: [bucket], profileId: 'test-profile' }
      },
      list: async () => ({ objects: [item('report.txt')], nextMarker: '' }),
    }),
  )
  await w.connect({ name: 'work' }, { remember: true, useSaved: true })
  w.selection.value = ['report.txt']
  fail = true
  await assert.rejects(
    w.connect({ name: 'work' }, { remember: true, useSaved: true }),
    /persistenceWrite/,
  )
  assert.equal(w.mode.value, 'live')
  assert.equal(w.activeConnectionId.value, 'test-profile')
  assert.deepEqual(w.selection.value, ['report.txt'])
  assert.equal(w.objects.value[0].key, 'report.txt')
  assert.equal(w.busy.value, false)
})

test('disconnect clears files and session state, and ignores an in-flight list response', async () => {
  let resolve
  const service = api()
  const w = useWorkspace(service)
  await w.connect({ name: 'work' })
  w.transfers.value = [{ name: 'report.txt' }]
  w.selection.value = ['report.txt']
  service.list = () =>
    new Promise((r) => {
      resolve = r
    })
  const pending = w.refresh()
  await w.disconnect()
  resolve({ objects: [item('late.txt')], nextMarker: 'late' })
  await pending
  assert.equal(w.mode.value, 'disconnected')
  assert.equal(w.bucket.value, null)
  assert.equal(w.activeConnectionId.value, null)
  assert.equal(w.loading.value, false)
  assert.equal(w.nextMarker.value, '')
  for (const name of ['buckets', 'objects', 'transfers', 'selection'])
    assert.deepEqual(w[name].value, [])
})

test('navigation clears selection and stale pagination; pages deduplicate object keys', async () => {
  const requests = []
  const w = useWorkspace(
    api({
      list: async (...args) => {
        requests.push(args)
        return { objects: [item(args[2] + 'report.txt')], nextMarker: args[3] ? '' : 'next-page' }
      },
    }),
  )
  await w.connect({})
  w.selection.value = ['report.txt']
  await w.navigate('folder/')
  assert.deepEqual(w.selection.value, [])
  assert.deepEqual(requests.at(-1), ['test-bucket', 'oss-cn-hangzhou', 'folder/', ''])
  await w.refresh(true)
  assert.equal(requests.at(-1)[3], 'next-page')
  assert.equal(w.objects.value.length, 1)
  assert.equal(w.nextMarker.value, '')
})

test('folder validation and deletion errors propagate; partial deletions are counted', async () => {
  const removed = []
  const w = useWorkspace(
    api({
      list: async () => ({ objects: [item('existing/')], nextMarker: '' }),
      folder: async (...args) => assert.equal(args[2], 'new/'),
      remove: async (bucket, region, key) => {
        if (key === 'existing/') throw Error('errors.folderNotEmpty')
        removed.push(key)
      },
    }),
  )
  await w.connect({})
  await assert.rejects(w.createFolder('../bad'), /invalidFolder/)
  await assert.rejects(w.createFolder('existing'), /folderExists/)
  await w.createFolder(' new ')
  w.selection.value = ['report.txt', 'existing/']
  await assert.rejects(w.removeSelected(), /folderNotEmpty/)
  assert.deepEqual(removed, ['report.txt'])
  assert.deepEqual(w.toast.value, { key: 'feedback.deleted', params: { count: 1 } })
  assert.equal(w.busy.value, false)
})

test('upload keeps file bytes and bucket destination, records server errors and size limits', async () => {
  const uploads = []
  const w = useWorkspace(
    api({
      upload: async (...args) => {
        if (uploads.length) throw Error('errors.fileExists')
        uploads.push(args)
      },
    }),
  )
  await w.connect({})
  await w.navigate('files/')
  const file = new File(['hello 世界'], 'hello.txt', { type: 'text/plain' })
  await w.upload([file, file, { name: 'large.bin', size: 101 * 1024 * 1024 }])
  assert.deepEqual(uploads[0].slice(0, 3), ['test-bucket', 'oss-cn-hangzhou', 'files/hello.txt'])
  assert.equal(await uploads[0][3].text(), 'hello 世界')
  assert.deepEqual(
    w.transfers.value.map((t) => t.status),
    ['error', 'error', 'done'],
  )
  assert.match(w.transfers.value[0].error, /fileLimit/)
  assert.match(w.transfers.value[1].error, /fileExists/)
  assert.equal(w.busy.value, false)
})

test('download distinguishes save success, cancellation and failure', async () => {
  let outcome = false
  const w = useWorkspace(
    api({
      download: async () => {
        if (outcome === 'error') throw Error('errors.saveFile')
        return outcome
      },
    }),
  )
  await w.connect({})
  for (const [value, status] of [
    [false, 'cancelled'],
    [true, 'done'],
    ['error', 'error'],
  ]) {
    outcome = value
    await w.download(item('report.txt'))
    assert.equal(w.transfers.value[0].status, status)
    assert.equal(w.busy.value, false)
  }
})

test('search and stars retain bucket boundaries and select only visible files', async () => {
  const w = useWorkspace(
    api({
      list: async () => ({ objects: [item('Report.txt'), item('other.json')], nextMarker: '' }),
    }),
  )
  await w.connect({})
  w.search.value = 'REPORT'
  w.toggleStar(w.visible.value[0])
  w.selectAll()
  assert.deepEqual(w.selection.value, ['Report.txt'])
  w.search.value = ''
  w.view.value = 'starred'
  assert.deepEqual(
    w.visible.value.map((o) => o.key),
    ['Report.txt'],
  )
  await w.changeBucket({ name: 'second-bucket', region: 'oss-cn-hangzhou' })
  w.view.value = 'starred'
  assert.deepEqual(w.visible.value, [])
})

test('history limit drops only old finished tasks and always keeps active tasks', async () => {
  const original = preferences.historyLimit
  const w = useWorkspace(api())
  try {
    preferences.historyLimit = 100
    w.transfers.value = [
      { id: 'in-progress', status: 'active' },
      ...Array.from({ length: 80 }, (_, id) => ({ id, status: id % 2 ? 'done' : 'error' })),
      { id: 'older-active', status: 'active' },
    ]
    preferences.historyLimit = 50
    await nextTick()
    assert.equal(w.transfers.value.length, 52)
    assert.equal(w.transfers.value[0].id, 'in-progress')
    assert.equal(w.transfers.value.at(-1).id, 'older-active')
    assert.equal(w.transfers.value[50].id, 49)
  } finally {
    preferences.historyLimit = original
  }
})
