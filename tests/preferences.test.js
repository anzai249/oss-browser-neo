import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createPreferences,
  sanitizePreferences,
  preferenceDefaults,
  PREFERENCES_KEY,
} from '../src/composables/usePreferences.js'

test('preferences persist, restore and reset without touching language or credentials', () => {
  const stored = new Map([['oss-neo-locale', 'system']])
  const storage = {
    getItem: (key) => stored.get(key),
    setItem: (key, value) => stored.set(key, value),
  }
  const first = createPreferences(storage)
  first.preferences.imagePreview = false
  first.preferences.theme = 'dark'
  first.preferences.pageSize = 500
  first.preferences.timeoutSeconds = 60
  first.preferences.readRetries = 3
  const second = createPreferences(storage)
  assert.equal(second.preferences.imagePreview, false)
  assert.equal(second.preferences.theme, 'dark')
  assert.equal(second.preferences.pageSize, 500)
  assert.equal(second.preferences.timeoutSeconds, 60)
  assert.equal(second.preferences.readRetries, 3)
  second.resetPreferences()
  assert.deepEqual(JSON.parse(stored.get(PREFERENCES_KEY)), preferenceDefaults)
  assert.equal(stored.get('oss-neo-locale'), 'system')
  assert.equal(stored.size, 2)
})

test('malformed storage and out-of-range settings use safe defaults', () => {
  assert.deepEqual(
    sanitizePreferences({
      imagePreview: 'false',
      theme: 'sepia',
      pageSize: 100000,
      timeoutSeconds: -1,
      readRetries: 100,
      historyLimit: 0,
      secret: 'ignored',
    }),
    preferenceDefaults,
  )
  assert.deepEqual(
    createPreferences({ getItem: () => 'broken json' }).preferences,
    preferenceDefaults,
  )
  const local = createPreferences({
    getItem: () => {
      throw Error()
    },
    setItem: () => {
      throw Error()
    },
  })
  local.preferences.imagePreview = false
  assert.equal(local.preferences.imagePreview, false)
  assert.equal(local.storageError.value, true)
})
