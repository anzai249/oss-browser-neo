import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { computed } from 'vue'
import {
  i18n,
  messages,
  supportedLocales,
  matchLocale,
  detectLocale,
  readLocalePreference,
  localePreference,
  systemLanguages,
  syncSystemLocale,
  setLocale,
  formatDate,
  formatNumber,
  itemCount,
  messageText,
  LOCALE_STORAGE_KEY,
} from '../src/i18n/index.js'
import { useWorkspace } from '../src/composables/useWorkspace.js'

function flatten(value, prefix = '') {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key
      return typeof child === 'string' ? [[path, child]] : Object.entries(flatten(child, path))
    }),
  )
}
const catalogs = Object.fromEntries(
  Object.entries(messages).map(([locale, value]) => [locale, flatten(value)]),
)
const placeholders = (message) =>
  [...new Set([...message.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort()

test('all languages have complete, compilable messages with matching interpolation parameters', () => {
  const keys = Object.keys(catalogs.en).sort()
  for (const { value: locale } of supportedLocales) {
    assert.deepEqual(Object.keys(catalogs[locale]).sort(), keys)
    setLocale(locale)
    for (const key of keys) {
      const message = catalogs[locale][key]
      assert.ok(message.trim(), `${locale}: ${key}`)
      assert.deepEqual(placeholders(message), placeholders(catalogs.en[key]), `${locale}: ${key}`)
      const rendered = i18n.global.t(
        key,
        { count: 2, name: '測試 & file', path: 'a/b', type: 'PDF', detail: '403' },
        { plural: 2 },
      )
      assert.notEqual(rendered, key, `${locale}: ${key}`)
      assert.ok(!rendered.includes('{count}'), `${locale}: ${key}`)
    }
  }
})

test('language negotiation respects saved preferences, Chinese scripts, and browser fallbacks', () => {
  assert.equal(matchLocale('zh-Hant-HK'), 'zh-TW')
  assert.equal(matchLocale('zh-Hans-TW'), 'zh-CN')
  assert.equal(matchLocale('zh_MO'), 'zh-TW')
  assert.equal(matchLocale('zh-SG'), 'zh-CN')
  assert.equal(matchLocale('en-AU'), 'en')
  assert.equal(matchLocale('ja-JP'), undefined)
  assert.equal(detectLocale({ getItem: () => 'zh-TW' }, ['en-US']), 'zh-TW')
  assert.equal(detectLocale({ getItem: () => 'invalid' }, ['ja-JP', 'en-GB']), 'en')
  assert.equal(
    detectLocale(
      {
        getItem: () => {
          throw Error('denied')
        },
      },
      ['zh-CN'],
    ),
    'zh-CN',
  )
  assert.equal(detectLocale(undefined, ['de-DE']), 'zh-TW')
})

test('switching persists preferences and rejects unsupported locale values', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const saved = new Map()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { setItem: (k, v) => saved.set(k, v) },
  })
  try {
    assert.equal(setLocale('zh-CN'), true)
    assert.equal(saved.get(LOCALE_STORAGE_KEY), 'zh-CN')
    assert.equal(setLocale('fr'), false)
    assert.equal(i18n.global.locale.value, 'zh-CN')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        throw Error('denied')
      },
    })
    assert.doesNotThrow(() => setLocale('en'))
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete globalThis.localStorage
  }
})

test('counts, dates, and numbers use the active locale without truncating formatted dates', () => {
  setLocale('en')
  assert.equal(itemCount('files.itemCount', 0), 'No items')
  assert.equal(itemCount('files.itemCount', 1), '1 item')
  assert.equal(itemCount('files.itemCount', 1250), '1,250 items')
  const date = '2026-12-31T08:30:00Z'
  for (const locale of ['en', 'zh-TW', 'zh-CN']) {
    setLocale(locale)
    assert.equal(
      formatDate(date, false),
      new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(
        new Date(date),
      ),
    )
    assert.equal(formatNumber(1234.5), new Intl.NumberFormat(locale).format(1234.5))
  }
  assert.equal(formatDate('not-a-date'), '—')
})

test('existing error and toast descriptors react to language changes without mutating user text', () => {
  const name = '<script>alert(1)</script> 品牌'
  const toast = computed(() => messageText({ key: 'feedback.folderCreated', params: { name } }))
  setLocale('en')
  assert.equal(toast.value, `Created “${name}”`)
  assert.equal(messageText('Error: errors.folderExists'), 'A folder with this name already exists.')
  assert.match(messageText('errors.httpStatus|403 Forbidden'), /403 Forbidden/)
  assert.equal(
    messageText('AccessDenied: raw OSS message (Request ID: 123)'),
    'AccessDenied: raw OSS message (Request ID: 123)',
  )
  setLocale('zh-TW')
  assert.equal(toast.value, `已建立「${name}」`)
  assert.equal(messageText('errors.folderExists'), '同名資料夾已存在。')
})

test('switching languages preserves the current folder, selection, search, and custom file names', async () => {
  const w = useWorkspace({
    connect: async () => ({
      buckets: [{ name: 'test-bucket', region: 'cn-hangzhou' }],
      profileId: null,
    }),
    list: async () => ({
      objects: [{ key: 'brand-assets/color-palette.json', size: 12 }],
      nextMarker: '',
    }),
  })
  await w.connect({})
  await w.navigate('brand-assets/')
  w.search.value = 'palette'
  w.selection.value = ['brand-assets/color-palette.json']
  for (const locale of ['en', 'zh-CN', 'zh-TW']) {
    setLocale(locale)
    assert.equal(w.prefix.value, 'brand-assets/')
    assert.equal(w.search.value, 'palette')
    assert.equal(w.visible.value[0].key, 'brand-assets/color-palette.json')
    assert.deepEqual(w.selection.value, ['brand-assets/color-palette.json'])
  }
})

test('all Rust error codes and static UI translation keys exist in every catalog', () => {
  const rust = ['oss.rs', 'connections.rs']
    .map((file) => fs.readFileSync(new URL(`../src-tauri/src/${file}`, import.meta.url), 'utf8'))
    .join('\n')
  const sources = [
    'App.vue',
    'components/LanguageSwitcher.vue',
    'components/ConnectionForm.vue',
    'components/PreferencesPanel.vue',
    'components/ImagePreview.vue',
  ]
    .map((file) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'))
    .join('\n')
  const keys = [...rust.matchAll(/"(errors\.\w+)/g), ...sources.matchAll(/\bt\('([\w.-]+)'/g)].map(
    (match) => match[1],
  )
  for (const key of keys)
    for (const locale of Object.keys(catalogs))
      assert.ok(catalogs[locale][key], `${locale} missing ${key}`)
  assert.equal(/[\p{Script=Han}]/u.test(sources), false, 'UI copy should live in locale files')
})

test('system preference persists independently of the resolved language and follows changes', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const saved = new Map()
  const storage = {
    getItem: (key) => saved.get(key),
    setItem: (key, value) => saved.set(key, value),
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  try {
    setLocale('zh-CN')
    assert.equal(setLocale('system', ['en-AU']), true)
    assert.equal(localePreference.value, 'system')
    assert.equal(i18n.global.locale.value, 'en')
    assert.equal(saved.get(LOCALE_STORAGE_KEY), 'system')
    assert.equal(readLocalePreference(storage), 'system')
    assert.equal(detectLocale(storage, ['zh-Hant-HK']), 'zh-TW')
    syncSystemLocale(['zh-SG'])
    assert.equal(i18n.global.locale.value, 'zh-CN')
    assert.equal(localePreference.value, 'system')
    assert.equal(saved.get(LOCALE_STORAGE_KEY), 'system')
    setLocale('en')
    syncSystemLocale(['zh-TW'])
    assert.equal(i18n.global.locale.value, 'en')
    assert.equal(localePreference.value, 'en')
    assert.equal(detectLocale(storage, ['zh-TW']), 'en')
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete globalThis.localStorage
  }
})

test('system language handles first launch, unavailable storage and language fallbacks', () => {
  assert.equal(readLocalePreference(undefined), 'system')
  assert.equal(readLocalePreference({ getItem: () => 'outdated' }), 'system')
  assert.equal(
    readLocalePreference({
      getItem: () => {
        throw Error('denied')
      },
    }),
    'system',
  )
  assert.deepEqual(systemLanguages({ language: 'en-AU' }), ['en-AU'])
  assert.deepEqual(systemLanguages({ languages: [], language: 'zh-TW' }), ['zh-TW'])
  assert.deepEqual(systemLanguages({ languages: ['zh-CN', 'en'], language: 'en' }), ['zh-CN', 'en'])
  assert.deepEqual(systemLanguages({}), [])
  assert.equal(detectLocale(undefined, ['ja', 'en-AU']), 'en')
  setLocale('system', ['de-DE'])
  assert.equal(i18n.global.locale.value, 'zh-TW')
  setLocale('zh-TW')
})
