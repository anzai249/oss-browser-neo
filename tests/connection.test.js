import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useConnectionForm } from '../src/composables/useConnectionForm.js'
const profile = {
  id: 'one',
  name: 'work',
  region: 'cn-hangzhou',
  bucket: 'test-bucket',
  accessKeyId: 'test-id',
}
const other = {
  ...profile,
  id: 'two',
  name: 'other',
  bucket: 'other-bucket',
  accessKeyId: 'other-id',
}
const catalog = (profiles) => ({ profiles, cleanupPending: false })
const setup = (options) =>
  useConnectionForm({
    isDesktop: true,
    connect: async () => {},
    api: { savedConnections: async () => catalog([]) },
    ...options,
  })

test('web preview never reads, saves or connects credentials', async () => {
  const f = setup({
    isDesktop: false,
    api: { savedConnections: () => assert.fail(), saveConnection: () => assert.fail() },
    connect: () => assert.fail(),
  })
  await f.loadSaved()
  await f.submit()
  await f.save()
  assert.equal(f.checking.value, false)
  assert.deepEqual(f.profiles.value, [])
})
test('active connection is selected, and switching rows never carries secrets between profiles', async () => {
  const f = setup({
    activeId: () => 'two',
    api: { savedConnections: async () => catalog([profile, other]) },
  })
  await f.loadSaved()
  assert.equal(f.saved.value.id, 'two')
  f.changeCredentials()
  f.credentials.value.accessKeySecret = 'private'
  f.restore(profile)
  assert.equal(f.credentials.value.accessKeySecret, '')
  assert.equal(f.credentials.value.accessKeyId, 'test-id')
  assert.equal(f.useSaved.value, true)
  f.newConnection()
  assert.equal(f.saved.value, null)
  assert.equal(f.credentials.value.accessKeyId, '')
  assert.equal(f.profiles.value.length, 2)
})
test('restoring identifies the exact saved credential without exposing its secret', async () => {
  let connected = false
  const f = setup({
    api: { savedConnections: async () => catalog([profile]) },
    connect: async (value, options) => {
      assert.deepEqual(options, { remember: true, useSaved: true, profileId: 'one' })
      assert.equal(value.accessKeySecret, '')
      assert.equal(value.securityToken, '')
      assert.equal(value.name, 'work')
    },
    onConnected: () => {
      connected = true
    },
  })
  await f.loadSaved()
  await f.submit()
  assert.equal(connected, true)
})
test('saving creates independently of connecting, editing keeps its ID and other profiles', async () => {
  let all = [profile],
    input
  const f = setup({
    connect: () => assert.fail('save must not connect'),
    api: {
      savedConnections: async () => catalog(all),
      saveConnection: async (value, options) => {
        input = options
        const saved = { ...value, id: options.profileId || 'two' }
        delete saved.accessKeySecret
        delete saved.securityToken
        all = [...all.filter((p) => p.id !== saved.id), saved]
        return saved
      },
    },
  })
  await f.loadSaved()
  f.newConnection()
  f.credentials.value.name = 'new'
  f.credentials.value.accessKeyId = 'new-id'
  f.credentials.value.accessKeySecret = 'new-secret'
  await f.save()
  assert.deepEqual(input, { profileId: null, useSaved: false })
  assert.equal(f.saved.value.id, 'two')
  assert.equal(f.credentials.value.accessKeySecret, '')
  f.credentials.value.name = 'renamed'
  await f.save()
  assert.deepEqual(input, { profileId: 'two', useSaved: true })
  assert.equal(all.length, 2)
  assert.equal(all[0].name, 'work')
  assert.equal(f.saved.value.name, 'renamed')
})
test('replacement credentials require a fresh secret; session-only connect leaves saved data unchanged', async () => {
  let calls = 0
  const f = setup({
    api: { savedConnections: async () => catalog([profile]) },
    connect: async (value, options) => {
      calls++
      assert.equal(value.accessKeySecret, 'replacement')
      assert.deepEqual(options, { remember: false, useSaved: false, profileId: 'one' })
    },
  })
  await f.loadSaved()
  f.changeCredentials()
  await f.submit()
  assert.equal(f.formError.value, 'errors.credentialsRequired')
  assert.equal(calls, 0)
  f.credentials.value.accessKeySecret = ' replacement '
  f.remember.value = false
  await f.submit()
  assert.equal(calls, 1)
  assert.equal(f.credentials.value.accessKeySecret, '')
})
test('failed saves keep the selected profile and draft for retry; repeated submissions are blocked', async () => {
  let reject,
    calls = 0
  const f = setup({
    api: {
      savedConnections: async () => catalog([profile]),
      saveConnection: () =>
        new Promise((resolve, fail) => {
          reject = fail
          calls++
        }),
    },
  })
  await f.loadSaved()
  f.credentials.value.name = 'draft'
  const pending = f.save()
  await f.save()
  f.newConnection()
  assert.equal(calls, 1)
  assert.equal(f.saved.value.id, 'one')
  reject(Error('errors.persistenceWrite'))
  await pending
  assert.equal(f.saved.value.name, 'work')
  assert.equal(f.credentials.value.name, 'draft')
  assert.match(f.formError.value, /persistenceWrite/)
  assert.equal(f.locked.value, false)
})
test('deletion targets only the confirmed profile, with failures and cleanup warnings visible', async () => {
  let fail = true,
    removed
  const f = setup({
    api: {
      savedConnections: async () => catalog([profile, other]),
      forgetConnection: async (id) => {
        removed = id
        if (fail) throw Error('errors.persistenceRemove')
        return { profiles: [other], cleanupPending: true }
      },
    },
  })
  await f.loadSaved()
  await f.forget()
  assert.equal(removed, undefined)
  f.requestForget(profile)
  await f.forget()
  assert.equal(f.profiles.value.length, 2)
  assert.equal(f.deleteTarget.value.id, 'one')
  fail = false
  await f.forget()
  assert.equal(removed, 'one')
  assert.equal(f.profiles.value.length, 1)
  assert.equal(f.saved.value.id, 'two')
  assert.equal(f.deleteTarget.value, null)
  assert.equal(f.cleanupPending.value, true)
})
test('locked storage still allows a session-only connection', async () => {
  const f = setup({
    api: {
      savedConnections: async () => {
        throw Error('errors.persistenceRead')
      },
    },
  })
  await f.loadSaved()
  assert.match(f.loadError.value, /persistenceRead/)
  assert.equal(f.remember.value, false)
  assert.equal(f.locked.value, false)
})
