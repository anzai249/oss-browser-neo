import { computed, ref } from 'vue'
import { desktop, oss } from '../services/oss.js'

const emptyCredentials = () => ({
  name: '',
  region: 'cn-hangzhou',
  bucket: '',
  accessKeyId: '',
  accessKeySecret: '',
  securityToken: '',
})
export function useConnectionForm({
  connect,
  busy = () => false,
  activeId = () => null,
  onConnected = () => {},
  api = oss,
  isDesktop = desktop,
}) {
  const credentials = ref(emptyCredentials()),
    remember = ref(true),
    profiles = ref([]),
    saved = ref(null),
    useSaved = ref(false)
  const checking = ref(isDesktop),
    clearing = ref(false),
    saving = ref(false),
    submitting = ref(false)
  const loadError = ref(''),
    formError = ref(''),
    notice = ref(''),
    cleanupPending = ref(false),
    missingRemoved = ref(false)
  const deleteTarget = ref(null)
  const locked = computed(
    () => busy() || checking.value || clearing.value || saving.value || submitting.value,
  )
  function restore(profile) {
    saved.value = profile
    useSaved.value = !!profile
    credentials.value = {
      ...emptyCredentials(),
      ...(profile && {
        name: profile.name,
        region: profile.region,
        bucket: profile.bucket,
        accessKeyId: profile.accessKeyId,
      }),
    }
    remember.value = true
    formError.value = ''
    notice.value = ''
  }
  function newConnection() {
    if (locked.value) return
    restore(null)
  }
  function applyCatalog(result) {
    profiles.value = result.profiles
    cleanupPending.value = result.cleanupPending
    missingRemoved.value = !!result.missingRemoved
  }
  async function loadSaved(preferredId = activeId()) {
    if (!isDesktop) return
    checking.value = true
    loadError.value = ''
    try {
      applyCatalog(await api.savedConnections())
      restore(
        profiles.value.find((profile) => profile.id === preferredId) || profiles.value[0] || null,
      )
      if (missingRemoved.value) notice.value = 'connection.missingRemoved'
    } catch (e) {
      loadError.value = String(e)
      remember.value = false
    } finally {
      checking.value = false
    }
  }
  function changeCredentials() {
    if (locked.value) return
    useSaved.value = false
    credentials.value.accessKeySecret = ''
    credentials.value.securityToken = ''
    formError.value = ''
  }
  function requestForget(profile = saved.value) {
    if (!locked.value && profile) deleteTarget.value = profile
  }
  async function forget() {
    if (locked.value || !deleteTarget.value) return
    const id = deleteTarget.value.id
    clearing.value = true
    formError.value = ''
    try {
      applyCatalog(await api.forgetConnection(id))
      if (saved.value?.id === id) restore(profiles.value[0] || null)
      deleteTarget.value = null
      notice.value = 'connection.forgotten'
    } catch (e) {
      formError.value = String(e)
    } finally {
      clearing.value = false
    }
  }
  function values() {
    formError.value = ''
    notice.value = ''
    if (
      !useSaved.value &&
      (!credentials.value.accessKeyId.trim() || !credentials.value.accessKeySecret.trim())
    ) {
      formError.value = 'errors.credentialsRequired'
      return null
    }
    return Object.fromEntries(
      Object.entries(credentials.value).map(([key, value]) => [key, value.trim()]),
    )
  }
  async function save() {
    if (locked.value || !isDesktop) return
    const value = values()
    if (!value) return
    saving.value = true
    try {
      const profile = await api.saveConnection(value, {
        profileId: saved.value?.id || null,
        useSaved: useSaved.value,
      })
      const index = profiles.value.findIndex((p) => p.id === profile.id)
      if (index < 0) profiles.value.push(profile)
      else profiles.value[index] = profile
      restore(profile)
      notice.value = 'connection.savedNotice'
      // Catalog refresh also reports any pending cleanup without turning a
      // successful save into an error or accidentally creating a duplicate.
      try {
        applyCatalog(await api.savedConnections())
        loadError.value = ''
      } catch (e) {
        loadError.value = String(e)
      }
    } catch (e) {
      formError.value = String(e)
    } finally {
      saving.value = false
    }
  }
  async function submit() {
    if (locked.value || !isDesktop) return
    const value = values()
    if (!value) return
    submitting.value = true
    try {
      await connect(value, {
        remember: remember.value,
        useSaved: useSaved.value,
        profileId: saved.value?.id || null,
      })
      credentials.value.accessKeySecret = ''
      credentials.value.securityToken = ''
      onConnected()
    } catch (e) {
      formError.value = String(e)
    } finally {
      submitting.value = false
    }
  }
  return {
    credentials,
    remember,
    profiles,
    saved,
    useSaved,
    checking,
    clearing,
    saving,
    submitting,
    loadError,
    formError,
    notice,
    cleanupPending,
    deleteTarget,
    locked,
    restore,
    loadSaved,
    newConnection,
    changeCredentials,
    requestForget,
    forget,
    save,
    submit,
  }
}
