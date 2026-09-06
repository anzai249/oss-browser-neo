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

test('multipart upload reports progress and speed, pauses between parts, then resumes', async () => {
  let releaseFirstPart
  const uploadedParts = []
  let completedParts
  const w = useWorkspace(
    api({
      startUpload: async () => 'upload-1',
      uploadPart: async (_bucket, _region, _key, uploadId, partNumber, blob) => {
        uploadedParts.push({ uploadId, partNumber, size: blob.size })
        if (partNumber === 1)
          await new Promise((resolve) => {
            releaseFirstPart = resolve
          })
        return `"etag-${partNumber}"`
      },
      completeUpload: async (_bucket, _region, _key, _uploadId, parts) => {
        completedParts = parts
      },
      abortUpload: () => assert.fail('a resumed upload must not be aborted'),
    }),
  )
  await w.connect({})
  const payload = new Uint8Array(2 * 1024 * 1024 + 17)
  const pending = w.upload([new File([payload], 'movie.bin')])
  while (!releaseFirstPart) await Promise.resolve()
  const task = w.transfers.value[0]
  assert.equal(task.status, 'active')
  w.pauseUpload(task.id)
  releaseFirstPart()
  while (task.loaded === 0) await Promise.resolve()
  assert.equal(task.status, 'paused')
  assert.equal(uploadedParts.length, 1)
  assert.equal(task.progress, 50)
  assert.ok(task.speed > 0)
  w.resumeUpload(task.id)
  await pending
  assert.equal(task.status, 'done')
  assert.equal(task.progress, 100)
  assert.equal(task.loaded, payload.length)
  assert.deepEqual(
    uploadedParts.map((part) => part.size),
    [1024 * 1024, 1024 * 1024, 17],
  )
  assert.deepEqual(
    completedParts.map((part) => part.partNumber),
    [1, 2, 3],
  )
})

test('cancelling a multipart upload aborts it and completed uploads can be revealed', async () => {
  let releasePart
  const aborted = []
  let completed = false
  let currentPrefix = ''
  const w = useWorkspace(
    api({
      list: async (_bucket, _region, prefix) => {
        currentPrefix = prefix
        return {
          objects: prefix === 'uploads/' ? [item('uploads/final.bin')] : [],
          nextMarker: '',
        }
      },
      startUpload: async () => 'upload-cancel',
      uploadPart: async () => {
        await new Promise((resolve) => {
          releasePart = resolve
        })
        return '"etag"'
      },
      completeUpload: async () => {
        completed = true
      },
      abortUpload: async (...args) => aborted.push(args),
      signedUrl: async (...args) => `https://signed.example/${args[2]}?expires=${args[3]}`,
    }),
  )
  await w.connect({})
  const pending = w.upload([new File([new Uint8Array(2 * 1024 * 1024)], 'cancel.bin')])
  while (!releasePart) await Promise.resolve()
  const task = w.transfers.value[0]
  w.cancelUpload(task.id)
  releasePart()
  await pending
  assert.equal(task.status, 'cancelled')
  assert.equal(completed, false)
  assert.deepEqual(aborted[0].slice(2), ['cancel.bin', 'upload-cancel'])

  const finished = {
    direction: 'upload',
    status: 'done',
    bucket: 'test-bucket',
    key: 'uploads/final.bin',
  }
  const revealed = await w.showTransfer(finished)
  assert.equal(currentPrefix, 'uploads/')
  assert.equal(w.view.value, 'files')
  assert.equal(revealed.key, 'uploads/final.bin')
  assert.equal(w.focused.value.key, revealed.key)
  assert.deepEqual(w.selection.value, [revealed.key])
  assert.equal(
    await w.createSignedUrl(revealed, 3600),
    'https://signed.example/uploads/final.bin?expires=3600',
  )
})

test('copy, move and rename pass validated object paths and refresh the folder', async () => {
  const operations = []
  let lists = 0
  const w = useWorkspace(
    api({
      list: async () => {
        lists++
        return { objects: [item('folder/report.txt')], nextMarker: '' }
      },
      copyObject: async (...args) => operations.push(args),
    }),
  )
  await w.connect({})
  const source = item('folder/report.txt')
  await w.copyObject(source, ' archive/report-copy.txt ', false)
  await w.copyObject(source, 'folder/renamed.txt', true)
  assert.deepEqual(operations, [
    ['test-bucket', 'oss-cn-hangzhou', 'folder/report.txt', 'archive/report-copy.txt', false],
    ['test-bucket', 'oss-cn-hangzhou', 'folder/report.txt', 'folder/renamed.txt', true],
  ])
  assert.equal(lists, 3)
  await assert.rejects(w.copyObject(source, source.key, false), /invalidCopyTarget/)
  await assert.rejects(w.copyObject(source, '../', false), /invalidCopyTarget/)
})

test('object ACL, headers, restore and symbolic link operations delegate and refresh safely', async () => {
  const calls = []
  const source = item('folder/archive.zip')
  const headers = {
    contentType: 'application/zip',
    cacheControl: 'private',
    metadata: { 'x-oss-meta-owner': 'team' },
  }
  const w = useWorkspace(
    api({
      setAcl: async (...args) => calls.push(['acl', ...args]),
      getHeaders: async (...args) => {
        calls.push(['getHeaders', ...args])
        return headers
      },
      setHeaders: async (...args) => calls.push(['setHeaders', ...args]),
      restore: async (...args) => calls.push(['restore', ...args]),
      createSymlink: async (...args) => calls.push(['symlink', ...args]),
    }),
  )
  await w.connect({})
  assert.equal(await w.getObjectHeaders(source), headers)
  await w.setObjectAcl(source, 'private')
  await w.setObjectHeaders(source, headers)
  await w.restoreObject(source, 3)
  await w.createObjectSymlink(source, ' links/archive.zip ')
  assert.deepEqual(calls, [
    ['getHeaders', 'test-bucket', 'oss-cn-hangzhou', source.key],
    ['acl', 'test-bucket', 'oss-cn-hangzhou', source.key, 'private'],
    ['setHeaders', 'test-bucket', 'oss-cn-hangzhou', source.key, headers],
    ['restore', 'test-bucket', 'oss-cn-hangzhou', source.key, 3],
    ['symlink', 'test-bucket', 'oss-cn-hangzhou', source.key, 'links/archive.zip'],
  ])
  await assert.rejects(w.createObjectSymlink(source, source.key), /invalidSymlink/)
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
