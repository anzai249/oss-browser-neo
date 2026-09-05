import { createI18n } from 'vue-i18n'
import { ref, watch } from 'vue'
import { en as vuetifyEn, zhHant, zhHans } from 'vuetify/locale'
import en from './locales/en.json' with { type: 'json' }
import zhTW from './locales/zh-TW.json' with { type: 'json' }
import zhCN from './locales/zh-CN.json' with { type: 'json' }

export const LOCALE_STORAGE_KEY = 'oss-neo-locale'
export const supportedLocales = [
  { value: 'zh-TW', label: '繁體中文', shortLabel: '繁中' },
  { value: 'zh-CN', label: '简体中文', shortLabel: '简中' },
  { value: 'en', label: 'English', shortLabel: 'EN' },
]
const supported = new Set(supportedLocales.map(({ value }) => value))
export const messages = { 'zh-TW': zhTW, 'zh-CN': zhCN, en }

export function matchLocale(language) {
  if (typeof language !== 'string') return undefined
  const tag = language.toLowerCase().replaceAll('_', '-')
  if (/^zh(?:-|$)/.test(tag)) {
    if (tag.includes('hant')) return 'zh-TW'
    if (tag.includes('hans')) return 'zh-CN'
    return /(?:^|-)(tw|hk|mo)(?:-|$)/.test(tag) ? 'zh-TW' : 'zh-CN'
  }
  return /^en(?:-|$)/.test(tag) ? 'en' : undefined
}

export function readLocalePreference(storage) {
  try {
    const saved = storage?.getItem(LOCALE_STORAGE_KEY)
    if (supported.has(saved)) return saved
  } catch {
    /* A denied storage permission must not prevent startup. */
  }
  return 'system'
}

export function systemLanguages(navigator = globalThis.navigator) {
  return navigator?.languages?.length
    ? navigator.languages
    : navigator?.language
      ? [navigator.language]
      : []
}

export function detectLocale(storage, languages = []) {
  const preference = readLocalePreference(storage)
  if (preference !== 'system') return preference
  for (const language of languages) {
    const match = matchLocale(language)
    if (match) return match
  }
  return 'zh-TW'
}

function initialPreference() {
  try {
    return readLocalePreference(globalThis.localStorage)
  } catch {
    return 'system'
  }
}

export const localePreference = ref(initialPreference())

export const i18n = createI18n({
  legacy: false,
  locale:
    localePreference.value === 'system'
      ? detectLocale(undefined, systemLanguages())
      : localePreference.value,
  fallbackLocale: 'en',
  messages: {
    'zh-TW': { ...zhTW, $vuetify: zhHant },
    'zh-CN': { ...zhCN, $vuetify: zhHans },
    en: { ...en, $vuetify: vuetifyEn },
  },
})

export function setLocale(value, languages = systemLanguages()) {
  if (value !== 'system' && !supported.has(value)) return false
  localePreference.value = value
  i18n.global.locale.value = value === 'system' ? detectLocale(undefined, languages) : value
  try {
    globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, value)
  } catch {
    /* Session-only fallback. */
  }
  return true
}

export function syncSystemLocale(languages = systemLanguages()) {
  if (localePreference.value === 'system') {
    i18n.global.locale.value = detectLocale(undefined, languages)
  }
}

export function formatNumber(value, options = {}) {
  return new Intl.NumberFormat(i18n.global.locale.value, options).format(value)
}

export function formatDate(value, includeTime = true) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat(i18n.global.locale.value, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  }).format(date)
}

export function itemCount(key, count) {
  return i18n.global.t(key, { count: formatNumber(count) }, { plural: count })
}

// Locale-neutral descriptors remain reactive when the language changes while a
// dialog, toast, or transfer error is already visible. Unknown service errors
// retain their original code, message, and request ID for troubleshooting.
export function messageText(value) {
  if (!value) return ''
  if (typeof value === 'object' && value.key) {
    if (typeof value.params?.count === 'number') return itemCount(value.key, value.params.count)
    return i18n.global.t(value.key, value.params || {})
  }
  const raw = String(value instanceof Error ? value.message : value).replace(/^Error:\s*/, '')
  const separator = raw.indexOf('|')
  const key = separator < 0 ? raw : raw.slice(0, separator)
  if (/^(errors|feedback)\./.test(key) && i18n.global.te(key)) {
    return i18n.global.t(key, { detail: separator < 0 ? '' : raw.slice(separator + 1) })
  }
  return raw
}

watch(
  i18n.global.locale,
  (locale) => {
    if (typeof document === 'undefined') return
    document.documentElement.lang = locale
    document.title = `OSS Browser — ${i18n.global.t('nav.files')}`
  },
  { immediate: true, flush: 'sync' },
)
