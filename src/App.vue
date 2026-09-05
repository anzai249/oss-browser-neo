<script setup>
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import Icon from './components/AppIcon.vue'
import { useFileDrop } from './composables/useFileDrop.js'
import LanguageSwitcher from './components/LanguageSwitcher.vue'
import ConnectionForm from './components/ConnectionForm.vue'
import PreferencesPanel from './components/PreferencesPanel.vue'
import ImagePreview from './components/ImagePreview.vue'
import { useI18n } from 'vue-i18n'
import { formatDate, formatNumber, itemCount, messageText, syncSystemLocale } from './i18n/index.js'
const { t } = useI18n()
import { useWorkspace, formatSize, fileName, fileKind, fileIcon } from './composables/useWorkspace'
const {
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
  download,
  removeSelected,
} = useWorkspace()
const preferencesDialog = ref(false),
  connectionDialog = ref(false),
  folderDialog = ref(false),
  deleteDialog = ref(false),
  helpDialog = ref(false),
  folderName = ref(''),
  formError = ref(''),
  listView = ref('list'),
  dropPanel = ref(null),
  sidebarOpen = ref(false),
  detailsOpen = ref(true),
  fileInput = ref(null),
  searchInput = ref(null)
const fileDrop = useFileDrop({
  enabled: () => mode.value === 'live' && !busy.value && !connectionDialog.value,
  panel: () => dropPanel.value,
})
const { dragging } = fileDrop
let unbindFileDrop
watch([view, mode, bucket, prefix, busy, connectionDialog], fileDrop.reset)
const updateSystemLocale = () => syncSystemLocale()
const regions = computed(() => [
  { title: t('regions.cn-hangzhou'), value: 'cn-hangzhou' },
  { title: t('regions.cn-shanghai'), value: 'cn-shanghai' },
  { title: t('regions.cn-beijing'), value: 'cn-beijing' },
  { title: t('regions.cn-shenzhen'), value: 'cn-shenzhen' },
  { title: t('regions.cn-hongkong'), value: 'cn-hongkong' },
  { title: t('regions.ap-southeast-1'), value: 'ap-southeast-1' },
  { title: t('regions.ap-southeast-2'), value: 'ap-southeast-2' },
  { title: t('regions.us-west-1'), value: 'us-west-1' },
  { title: t('regions.eu-central-1'), value: 'eu-central-1' },
])
const workspaceName = connectionName
const regionLabel = computed(
  () =>
    regions.value.find((r) => r.value === bucket.value?.region.replace(/^oss-/, ''))?.title ||
    bucket.value?.region,
)
const breadcrumbs = computed(() =>
  prefix.value
    .split('/')
    .filter(Boolean)
    .map((name, i, parts) => ({ name, path: parts.slice(0, i + 1).join('/') + '/' })),
)
const totalSize = computed(() => objects.value.reduce((sum, o) => sum + o.size, 0))
const completed = computed(() => transfers.value.filter((t) => t.status === 'done').length)
const selectedSize = computed(() =>
  objects.value.filter((o) => selection.value.includes(o.key)).reduce((s, o) => s + o.size, 0),
)
function showConnection() {
  formError.value = ''
  connectionDialog.value = true
}
function pickBucket(b) {
  changeBucket(b)
  sidebarOpen.value = false
}
function requestDelete(item) {
  selection.value = [item.key]
  deleteDialog.value = true
}
function chooseFiles(event) {
  upload(Array.from(event.target.files))
  event.target.value = ''
}
function changeView(value) {
  view.value = value
  sidebarOpen.value = false
  search.value = ''
}
function openFolder() {
  folderName.value = ''
  formError.value = ''
  folderDialog.value = true
}
async function submitFolder() {
  try {
    formError.value = ''
    await createFolder(folderName.value)
    folderDialog.value = false
  } catch (e) {
    formError.value = String(e.message || e)
  }
}
async function submitDelete() {
  try {
    await removeSelected()
    deleteDialog.value = false
  } catch (e) {
    deleteDialog.value = false
    toast.value = String(e.message || e)
  }
}
function openItem(item) {
  if (item.isFolder) navigate(item.key)
  else {
    select(item)
    detailsOpen.value = true
  }
}
async function copyPath(item) {
  try {
    await navigator.clipboard.writeText(`oss://${bucket.value.name}/${item.key}`)
    toast.value = 'feedback.pathCopied'
  } catch {
    toast.value = 'errors.clipboard'
  }
}
function dropFiles(event) {
  const files = fileDrop.drop(event)
  if (files.length) upload(files)
}
function keyboard(event) {
  if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
    event.preventDefault()
    searchInput.value?.focus()
  }
  if (event.key === 'Escape') sidebarOpen.value = false
}
const narrowWindow = window.matchMedia('(max-width: 1050px)')
function adaptDetails(event) {
  if (event.matches) detailsOpen.value = false
}
onMounted(() => {
  window.addEventListener('keydown', keyboard)
  unbindFileDrop = fileDrop.bind(window)
  window.addEventListener('languagechange', updateSystemLocale)
  window.addEventListener('focus', updateSystemLocale)
  updateSystemLocale()
  adaptDetails(narrowWindow)
  narrowWindow.addEventListener('change', adaptDetails)
})
onUnmounted(() => {
  window.removeEventListener('keydown', keyboard)
  unbindFileDrop?.()
  window.removeEventListener('languagechange', updateSystemLocale)
  window.removeEventListener('focus', updateSystemLocale)
  narrowWindow.removeEventListener('change', adaptDetails)
})
</script>

<template>
  <v-app>
    <main v-if="mode !== 'live'" class="connection-screen">
      <header class="connection-screen-header">
        <span class="brand"
          ><img class="brand-mark" src="/favicon.svg" alt="" aria-hidden="true" /><span
            >oss<span class="brand-light">browser</span><small>NEO</small></span
          ></span
        >
        <div class="flex items-center gap-2">
          <LanguageSwitcher compact />
          <v-btn
            variant="text"
            size="small"
            icon
            class="icon-button"
            :aria-label="t('nav.settings')"
            @click="preferencesDialog = true"
          >
            <Icon name="cog-outline" :size="19" />
          </v-btn>
        </div>
      </header>
      <section class="connection-onboarding">
        <ConnectionForm :connect="connect" :busy="busy" />
      </section>
    </main>
    <div v-else class="app-shell">
      <div v-if="sidebarOpen" class="sidebar-backdrop" @click="sidebarOpen = false"></div>
      <aside class="sidebar" :class="{ 'is-open': sidebarOpen }">
        <a class="brand" href="#" @click.prevent="changeView('files')"
          ><img class="brand-mark" src="/favicon.svg" alt="" aria-hidden="true" /><span
            >oss<span class="brand-light">browser</span><small>NEO</small></span
          ></a
        >
        <v-list-item
          role="button"
          class="workspace-switch"
          variant="outlined"
          :disabled="busy"
          @click="showConnection"
        >
          <template #prepend
            ><span class="workspace-avatar"><Icon name="layers-triple-outline" /></span
          ></template>
          <strong>{{ workspaceName }}</strong
          ><small>Alibaba Cloud OSS</small>
          <template #append><Icon name="chevron-down" :size="17" /></template>
        </v-list-item>
        <div class="nav-label">{{ t('nav.workspace') }}</div>
        <v-list tag="nav" nav class="main-nav" :aria-label="t('nav.main')">
          <v-list-item
            role="button"
            :active="view === 'files'"
            :title="t('nav.files')"
            @click="changeView('files')"
          >
            <template #prepend><Icon name="folder-outline" /></template>
          </v-list-item>
          <v-list-item
            role="button"
            :active="view === 'starred'"
            :title="t('nav.starred')"
            @click="changeView('starred')"
          >
            <template #prepend><Icon name="star-outline" /></template>
          </v-list-item>
          <v-list-item
            role="button"
            :active="view === 'transfers'"
            :title="t('nav.transfers')"
            @click="changeView('transfers')"
          >
            <template #prepend><Icon name="swap-vertical" /></template>
            <template #append
              ><v-chip v-if="transfers.length" size="x-small">{{
                formatNumber(transfers.length)
              }}</v-chip></template
            >
          </v-list-item>
        </v-list>
        <div class="nav-label bucket-label">
          <span>{{ t('nav.buckets') }}</span
          ><v-chip size="x-small">{{ formatNumber(buckets.length) }}</v-chip>
        </div>
        <v-list tag="nav" nav class="bucket-nav" :aria-label="t('nav.bucketList')">
          <v-list-item
            role="button"
            v-for="b in buckets"
            :key="b.name"
            :active="b.name === bucket.name"
            :disabled="busy"
            :title="b.name"
            @click="pickBucket(b)"
          >
            <template #prepend><Icon name="database-outline" :size="18" /></template>
            <template #append
              ><Icon v-if="b.name === bucket.name" name="chevron-right" :size="15"
            /></template>
          </v-list-item>
        </v-list>
        <div class="sidebar-bottom">
          <v-list nav class="utility-nav">
            <v-list-item
              role="button"
              :active="view === 'settings'"
              :title="t('nav.settings')"
              @click="changeView('settings')"
            >
              <template #prepend><Icon name="cog-outline" /></template>
            </v-list-item>
            <v-list-item role="button" :title="t('nav.help')" @click="helpDialog = true">
              <template #prepend><Icon name="help-circle-outline" /></template>
              <template #append><Icon name="arrow-top-right" :size="15" /></template>
            </v-list-item>
          </v-list>
          <div class="sidebar-footer">
            <span class="tiny-brand">[ ]</span><span>{{ t('app.tagline') }}</span
            ><span>v0.1</span>
          </div>
        </div>
      </aside>

      <div class="main-shell">
        <header class="topbar">
          <v-btn
            variant="text"
            size="small"
            icon
            class="icon-button mobile-menu"
            :aria-label="t('nav.open')"
            @click="sidebarOpen = !sidebarOpen"
          >
            <Icon name="menu" />
          </v-btn>
          <div class="topbar-title">
            {{ t('nav.workspace') }}<Icon name="chevron-right" :size="15" />
            <span>{{
              {
                files: t('nav.files'),
                starred: t('nav.starred'),
                transfers: t('nav.transfers'),
                settings: t('nav.settings'),
              }[view]
            }}</span>
          </div>
          <div class="topbar-right">
            <LanguageSwitcher compact />
            <v-chip class="connection-status" size="small" color="secondary" variant="tonal">{{
              t('connection.connected')
            }}</v-chip
            ><span class="topbar-divider"></span
            ><v-btn
              variant="text"
              size="small"
              icon
              class="avatar"
              :aria-label="t('nav.connection')"
              @click="showConnection"
            >
              S
            </v-btn>
          </div>
        </header>

        <main v-if="view === 'files' || view === 'starred'" class="workspace-main file-workspace">
          <div class="page-heading">
            <div>
              <div class="eyebrow">{{ t('files.eyebrow') }}</div>
              <h1>
                {{ view === 'starred' ? t('nav.starred') : t('nav.files')
                }}<span class="heading-dot">.</span>
              </h1>
              <p>
                {{ view === 'starred' ? t('files.starredSubtitle') : t('files.subtitle') }}
              </p>
            </div>
            <v-btn
              color="primary"
              height="32"
              :disabled="busy || loading"
              @click="fileInput.click()"
              ><Icon name="plus" :size="19" class="mr-2" />{{ t('actions.uploadFiles') }}</v-btn
            >
          </div>
          <input ref="fileInput" type="file" multiple hidden @change="chooseFiles" />
          <section class="bucket-overview">
            <div class="bucket-identity">
              <span class="bucket-symbol"><Icon name="database-outline" :size="25" /></span>
              <div>
                <h2>{{ bucket.name }}</h2>
                <span
                  ><i class="status-dot"></i>{{ regionLabel
                  }}<span class="overview-separator">/</span>OSS Bucket</span
                >
              </div>
            </div>
            <div class="bucket-metric">
              <span>{{ t('files.directory') }}</span
              ><strong
                >{{ itemCount('files.itemCount', objects.length)
                }}<small>{{ nextMarker ? '+' : '' }}</small></strong
              >
            </div>
            <div class="bucket-metric">
              <span>{{ t('files.size') }}</span
              ><strong>{{ formatSize(totalSize) }}</strong>
            </div>
            <v-chip size="small" variant="tonal" color="secondary" class="storage-pill"
              ><Icon name="shield-check-outline" :size="15" />{{ t('connection.secure') }}</v-chip
            >
          </section>

          <section
            ref="dropPanel"
            class="files-panel"
            :class="{ 'is-dragging': dragging }"
            @dragenter="fileDrop.enter"
            @dragover="fileDrop.over"
            @dragleave="fileDrop.leave"
            @drop="dropFiles"
          >
            <div v-if="dragging" class="drop-overlay">
              <Icon name="cloud-upload-outline" :size="46" /><strong>{{ t('files.drop') }}</strong
              ><span>{{ t('files.limit') }}</span>
            </div>
            <div class="file-toolbar">
              <v-breadcrumbs
                class="breadcrumbs"
                :items="[
                  { title: bucket.name, path: '' },
                  ...breadcrumbs.map((crumb) => ({ title: crumb.name, path: crumb.path })),
                ]"
              >
                <template #prepend>
                  <v-btn
                    icon
                    variant="text"
                    size="small"
                    :disabled="busy"
                    @click="navigate('')"
                    :aria-label="t('files.root')"
                    ><Icon name="home-outline" :size="18"
                  /></v-btn>
                </template>
                <template #divider><Icon name="chevron-right" :size="16" /></template>
                <template #item="{ item }">
                  <v-btn
                    variant="text"
                    size="small"
                    :disabled="busy"
                    @click="navigate(item.path)"
                    >{{ item.title }}</v-btn
                  >
                </template>
              </v-breadcrumbs>
              <v-btn
                variant="text"
                size="small"
                icon
                class="icon-button"
                :aria-label="t('actions.refresh')"
                :disabled="loading || busy"
                @click="refresh()"
              >
                <Icon name="refresh" :class="{ spinning: loading }" :size="19" />
              </v-btn>
            </div>
            <div class="file-controls">
              <v-text-field
                class="search-field"
                ref="searchInput"
                v-model="search"
                :placeholder="t('files.searchPlaceholder')"
                :aria-label="t('files.search')"
                hide-details
              >
                <template #prepend-inner><Icon name="magnify" :size="19" /></template>
                <template #append-inner><kbd>⌘ K</kbd></template>
              </v-text-field>
              <div class="file-control-actions flex items-center gap-2">
                <v-btn variant="text" size="small" :disabled="busy || loading" @click="openFolder"
                  ><Icon name="folder-plus-outline" :size="18" class="mr-2" />{{
                    t('folder.title')
                  }}</v-btn
                ><span class="controls-divider"></span
                ><v-select
                  class="sort-control"
                  v-model="sort"
                  :aria-label="t('files.sort')"
                  :items="[
                    { title: t('files.sortName'), value: 'name' },
                    { title: t('files.sortDate'), value: 'date' },
                    { title: t('files.size'), value: 'size' },
                  ]"
                  hide-details
                />
                <v-btn-toggle
                  class="view-toggle"
                  v-model="listView"
                  mandatory
                  divided
                  variant="outlined"
                  color="primary"
                  density="compact"
                  :aria-label="t('files.listView') + ' / ' + t('files.gridView')"
                >
                  <v-btn value="list" :aria-label="t('files.listView')"
                    ><Icon name="format-list-bulleted" :size="18"
                  /></v-btn>
                  <v-btn value="grid" :aria-label="t('files.gridView')"
                    ><Icon name="view-grid-outline" :size="17"
                  /></v-btn>
                </v-btn-toggle>
                <v-btn
                  variant="text"
                  size="small"
                  icon
                  :aria-pressed="detailsOpen"
                  class="icon-button details-toggle"
                  :class="{ 'text-orange-600': detailsOpen }"
                  :aria-label="t('files.toggleDetails')"
                  @click="detailsOpen = !detailsOpen"
                >
                  <Icon name="dock-right" :size="18" />
                </v-btn>
              </div>
            </div>
            <div v-if="selection.length" class="selection-bar">
              <span
                >{{ itemCount('files.selectedCount', selection.length) }}
                <small>· {{ formatSize(selectedSize) }}</small></span
              >
              <div class="flex gap-2">
                <v-btn
                  v-if="
                    selection.length === 1 && !objects.find((o) => o.key === selection[0])?.isFolder
                  "
                  variant="text"
                  size="small"
                  :disabled="busy"
                  @click="download(objects.find((o) => o.key === selection[0]))"
                  >{{ t('actions.download') }}</v-btn
                ><v-btn
                  color="error"
                  variant="text"
                  size="small"
                  :disabled="busy"
                  @click="deleteDialog = true"
                  ><Icon name="trash-can-outline" :size="16" class="mr-1" />{{
                    t('actions.delete')
                  }}</v-btn
                ><v-btn
                  variant="text"
                  size="small"
                  icon
                  class="icon-button"
                  :aria-label="t('files.clearSelection')"
                  @click="selection = []"
                >
                  <Icon name="close" :size="17" />
                </v-btn>
              </div>
            </div>
            <v-progress-linear v-if="loading" color="primary" indeterminate height="2" />
            <div class="file-content">
              <div class="file-list-area">
                <div v-if="error" class="empty-state">
                  <Icon name="cloud-alert-outline" :size="42" />
                  <h3>{{ t('files.readError') }}</h3>
                  <p>{{ messageText(error) }}</p>
                  <v-btn variant="tonal" color="primary" @click="refresh()">{{
                    t('actions.retry')
                  }}</v-btn>
                </div>
                <template v-else>
                  <div v-if="!visible.length && !loading" class="empty-state">
                    <span class="empty-icon"
                      ><Icon
                        :name="
                          search
                            ? 'file-search-outline'
                            : view === 'starred'
                              ? 'star-outline'
                              : 'folder-open-outline'
                        "
                        :size="38"
                    /></span>
                    <h3>
                      {{
                        search
                          ? t('files.noResults')
                          : view === 'starred'
                            ? t('files.noStars')
                            : t('files.emptyTitle')
                      }}
                    </h3>
                    <p>
                      {{
                        search
                          ? t('files.searchHint')
                          : view === 'starred'
                            ? t('files.starsHint')
                            : t('files.emptyHint')
                      }}
                    </p>
                    <v-btn
                      v-if="!search && view === 'files'"
                      variant="tonal"
                      color="primary"
                      :disabled="busy"
                      @click="fileInput.click()"
                      >{{ t('files.firstUpload') }}</v-btn
                    >
                  </div>
                  <v-table v-else-if="listView === 'list'" class="files-table" fixed-header hover>
                    <thead>
                      <tr>
                        <th class="checkbox-cell">
                          <v-checkbox-btn
                            :aria-label="t('files.selectAll')"
                            :model-value="
                              visible.length > 0 && visible.every((o) => selection.includes(o.key))
                            "
                            :indeterminate="
                              selection.length > 0 &&
                              !visible.every((o) => selection.includes(o.key))
                            "
                            @update:model-value="selectAll"
                          />
                        </th>
                        <th>
                          <v-btn variant="text" size="small" @click="sort = 'name'">
                            {{ t('files.name') }}<Icon name="arrow-up" :size="13" />
                          </v-btn>
                        </th>
                        <th>{{ t('files.shortSize') }}</th>
                        <th class="modified-column">{{ t('files.modified') }}</th>
                        <th class="class-column">{{ t('files.storageClass') }}</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        v-for="item in visible"
                        :key="item.key"
                        :class="{
                          'focused-row': focused?.key === item.key,
                          'checked-row': selection.includes(item.key),
                        }"
                        @click="select(item)"
                        @dblclick="openItem(item)"
                      >
                        <td class="checkbox-cell" @click.stop>
                          <v-checkbox-btn
                            :aria-label="t('files.select', { name: fileName(item) })"
                            :model-value="selection.includes(item.key)"
                            @update:model-value="toggleSelection(item)"
                          />
                        </td>
                        <td class="name-cell">
                          <v-btn
                            variant="text"
                            size="small"
                            class="file-name-button"
                            @click.stop="openItem(item)"
                          >
                            <span class="file-icon" :class="fileKind(item)"
                              ><Icon :name="fileIcon(item)" :size="23" /></span
                            ><span>{{ fileName(item) }}</span>
                          </v-btn>
                        </td>
                        <td class="size-cell">{{ formatSize(item.size) }}</td>
                        <td class="modified-column">
                          {{ formatDate(item.lastModified, false) }}
                        </td>
                        <td class="class-column">
                          <v-chip v-if="!item.isFolder" size="x-small" variant="tonal">{{
                            item.storageClass === 'IA'
                              ? t('files.infrequent')
                              : item.storageClass === 'Standard'
                                ? t('files.standard')
                                : item.storageClass
                          }}</v-chip
                          ><span v-else class="text-gray-300">—</span>
                        </td>
                        <td class="row-actions">
                          <v-btn
                            variant="text"
                            size="small"
                            icon
                            class="icon-button star-button"
                            :class="{ starred: isStarred(item) }"
                            :aria-label="
                              t(isStarred(item) ? 'files.unstar' : 'files.star', {
                                name: fileName(item),
                              })
                            "
                            @click.stop="toggleStar(item)"
                          >
                            <Icon
                              :name="isStarred(item) ? 'star' : 'star-outline'"
                              :size="17" /></v-btn
                          ><v-menu
                            ><template #activator="{ props }"
                              ><v-btn
                                variant="text"
                                size="small"
                                icon
                                v-bind="props"
                                class="icon-button"
                                :aria-label="t('files.more', { name: fileName(item) })"
                                @click.stop
                              >
                                <Icon name="dots-horizontal" :size="19" /></v-btn></template
                            ><v-list density="compact"
                              ><v-list-item role="button" @click="openItem(item)">{{
                                item.isFolder ? t('files.openFolder') : t('files.viewInfo')
                              }}</v-list-item
                              ><v-list-item
                                role="button"
                                v-if="!item.isFolder"
                                :disabled="busy"
                                @click="download(item)"
                                >{{ t('actions.downloadFile') }}</v-list-item
                              ><v-list-item role="button" @click="copyPath(item)">{{
                                t('actions.copyOssPath')
                              }}</v-list-item
                              ><v-list-item
                                role="button"
                                :disabled="busy"
                                class="text-red-600"
                                @click="requestDelete(item)"
                                >{{ t('actions.delete') }}</v-list-item
                              ></v-list
                            ></v-menu
                          >
                        </td>
                      </tr>
                    </tbody>
                  </v-table>
                  <div v-else class="file-grid">
                    <v-card
                      variant="outlined"
                      v-for="item in visible"
                      :key="item.key"
                      class="file-grid-card"
                      :class="{ selected: focused?.key === item.key }"
                    >
                      <div class="flex justify-between">
                        <v-checkbox-btn
                          :aria-label="t('files.select', { name: fileName(item) })"
                          :model-value="selection.includes(item.key)"
                          @update:model-value="toggleSelection(item)"
                        /><v-btn
                          variant="text"
                          size="small"
                          icon
                          class="icon-button"
                          :class="{ starred: isStarred(item) }"
                          :aria-label="
                            t(isStarred(item) ? 'files.unstar' : 'files.star', {
                              name: fileName(item),
                            })
                          "
                          @click="toggleStar(item)"
                        >
                          <Icon :name="isStarred(item) ? 'star' : 'star-outline'" :size="18" />
                        </v-btn>
                      </div>
                      <v-btn
                        variant="text"
                        size="small"
                        class="grid-file-open"
                        @click="openItem(item)"
                      >
                        <span class="file-icon" :class="fileKind(item)"
                          ><Icon :name="fileIcon(item)" :size="42" /></span
                        ><strong>{{ fileName(item) }}</strong
                        ><small>{{
                          item.isFolder ? t('files.folder') : formatSize(item.size)
                        }}</small>
                      </v-btn>
                    </v-card>
                  </div>
                  <div v-if="nextMarker" class="load-more">
                    <v-btn
                      variant="text"
                      color="primary"
                      :loading="loading"
                      @click="refresh(true)"
                      >{{ t('files.loadMore') }}</v-btn
                    >
                  </div>
                </template>
                <div class="file-list-footer">
                  <span
                    >{{ itemCount('files.itemCount', visible.length)
                    }}<span v-if="search"> · {{ t('files.filtered') }}</span
                    ><span v-if="view === 'starred'"> · {{ t('files.directory') }}</span></span
                  ><span
                    ><Icon name="cursor-default-click-outline" :size="14" />{{
                      t('files.interactionHint')
                    }}</span
                  >
                </div>
              </div>
              <div v-if="detailsOpen" class="details-backdrop" @click="detailsOpen = false"></div>
              <aside v-if="detailsOpen" class="details-panel">
                <div class="details-heading">
                  <span>{{ t('files.details') }}</span
                  ><v-btn
                    variant="text"
                    size="small"
                    icon
                    class="icon-button"
                    :aria-label="t('files.closeDetails')"
                    @click="detailsOpen = false"
                  >
                    <Icon name="close" :size="17" />
                  </v-btn>
                </div>
                <template v-if="focused"
                  ><ImagePreview :item="focused" :bucket="bucket" />
                  <div class="details-file-title">
                    <span class="file-icon" :class="fileKind(focused)"
                      ><Icon :name="fileIcon(focused)" :size="23"
                    /></span>
                    <div>
                      <h3>{{ fileName(focused) }}</h3>
                      <span>{{
                        focused.isFolder
                          ? t('files.folder')
                          : t('files.fileType', { type: fileKind(focused).toUpperCase() })
                      }}</span>
                    </div>
                    <v-btn
                      variant="text"
                      size="small"
                      icon
                      class="icon-button ml-auto"
                      :class="{ starred: isStarred(focused) }"
                      :aria-label="t('files.toggleStar')"
                      @click="toggleStar(focused)"
                    >
                      <Icon :name="isStarred(focused) ? 'star' : 'star-outline'" :size="19" />
                    </v-btn>
                  </div>
                  <div class="detail-section-label">{{ t('files.information') }}</div>
                  <dl class="file-metadata">
                    <div>
                      <dt>{{ t('files.size') }}</dt>
                      <dd>{{ formatSize(focused.size) }}</dd>
                    </div>
                    <div>
                      <dt>{{ t('files.storageClass') }}</dt>
                      <dd>
                        {{
                          focused.isFolder
                            ? '—'
                            : focused.storageClass === 'Standard'
                              ? t('files.standard')
                              : focused.storageClass
                        }}
                      </dd>
                    </div>
                    <div>
                      <dt>{{ t('files.modified') }}</dt>
                      <dd>{{ formatDate(focused.lastModified) }}</dd>
                    </div>
                    <div>
                      <dt>{{ t('files.region') }}</dt>
                      <dd>{{ regionLabel }}</dd>
                    </div>
                  </dl>
                  <div class="detail-section-label flex justify-between">
                    {{ t('files.path')
                    }}<v-btn
                      variant="text"
                      size="small"
                      :aria-label="t('files.copyPath')"
                      @click="copyPath(focused)"
                    >
                      <Icon name="content-copy" :size="14" />
                    </v-btn>
                  </div>
                  <div class="object-path">oss://{{ bucket.name }}/{{ focused.key }}</div>
                  <v-btn
                    v-if="!focused.isFolder"
                    class="download-button"
                    variant="outlined"
                    block
                    :disabled="busy"
                    @click="download(focused)"
                    ><Icon name="download" :size="18" class="mr-2" />{{
                      t('actions.downloadFile')
                    }}</v-btn
                  ><v-btn
                    v-else
                    variant="outlined"
                    block
                    :disabled="busy"
                    @click="navigate(focused.key)"
                    >{{ t('files.openFolder') }}</v-btn
                  ></template
                >
                <div v-else class="detail-placeholder">
                  <Icon name="file-document-outline" :size="42" />
                  <p>{{ t('files.selectHint') }}</p>
                </div>
              </aside>
            </div>
          </section>
          <div class="workspace-footer">
            <span><Icon name="cloud-check-outline" :size="16" />{{ t('connection.https') }}</span
            ><v-btn variant="text" size="small" @click="changeView('transfers')">
              <Icon name="swap-vertical" :size="17" />{{ t('nav.transfers')
              }}<span v-if="transfers.length" class="transfer-counter">{{
                formatNumber(transfers.length)
              }}</span
              ><Icon name="chevron-right" :size="16" />
            </v-btn>
          </div>
        </main>

        <main v-else-if="view === 'transfers'" class="workspace-main">
          <div class="page-heading">
            <div>
              <div class="eyebrow">{{ t('transfers.eyebrow') }}</div>
              <h1>{{ t('nav.transfers') }}<span class="heading-dot">.</span></h1>
              <p>{{ t('transfers.subtitle') }}</p>
            </div>
            <v-btn
              variant="outlined"
              :disabled="busy || !transfers.length"
              @click="transfers = transfers.filter((t) => t.status === 'active')"
              >{{ t('transfers.clear') }}</v-btn
            >
          </div>
          <div class="transfer-summary">
            <div>
              <Icon name="swap-vertical" :size="24" /><strong>{{
                formatNumber(transfers.length)
              }}</strong
              ><span>{{ t('transfers.all') }}</span>
            </div>
            <div>
              <Icon name="check-circle-outline" :size="24" /><strong>{{
                formatNumber(completed)
              }}</strong
              ><span>{{ t('transfers.done') }}</span>
            </div>
            <div>
              <Icon name="alert-circle-outline" :size="24" /><strong>{{
                formatNumber(transfers.filter((t) => t.status === 'error').length)
              }}</strong
              ><span>{{ t('transfers.incomplete') }}</span>
            </div>
          </div>
          <section class="secondary-panel">
            <div v-if="!transfers.length" class="empty-state large">
              <span class="empty-icon"><Icon name="cloud-sync-outline" :size="40" /></span>
              <h3>{{ t('transfers.emptyTitle') }}</h3>
              <p>{{ t('transfers.emptyHint') }}</p>
              <v-btn color="primary" variant="tonal" @click="changeView('files')">{{
                t('transfers.browse')
              }}</v-btn>
            </div>
            <div v-for="task in transfers" :key="task.id" class="transfer-row">
              <span class="transfer-direction"
                ><Icon :name="task.direction === 'upload' ? 'upload' : 'download'"
              /></span>
              <div class="flex-1 min-w-0">
                <strong>{{ task.name }}</strong>
                <p>
                  {{ task.bucket }} · {{ formatSize(task.size) }} ·
                  {{ task.direction === 'upload' ? t('actions.upload') : t('actions.download') }}
                </p>
                <p v-if="task.error" class="transfer-error">{{ messageText(task.error) }}</p>
                <v-progress-linear
                  v-if="task.status === 'active'"
                  indeterminate
                  color="primary"
                  class="mt-2"
                />
              </div>
              <span class="task-status" :class="task.status"
                ><Icon
                  :name="
                    task.status === 'done'
                      ? 'check-circle-outline'
                      : task.status === 'error'
                        ? 'alert-circle-outline'
                        : 'clock-outline'
                  "
                  :size="16"
                />{{
                  {
                    done: t('transfers.done'),
                    error: t('transfers.error'),
                    active: t('transfers.active'),
                    cancelled: t('transfers.cancelled'),
                  }[task.status]
                }}</span
              >
            </div>
          </section>
        </main>

        <main v-else class="workspace-main settings-page">
          <div class="page-heading">
            <div>
              <div class="eyebrow">{{ t('settings.eyebrow') }}</div>
              <h1>{{ t('nav.settings') }}<span class="heading-dot">.</span></h1>
              <p>{{ t('settings.subtitle') }}</p>
            </div>
          </div>
          <PreferencesPanel />
          <v-card tag="section" variant="outlined" class="settings-card language-settings">
            <span class="settings-icon"><Icon name="translate" :size="26" /></span>
            <div>
              <h2>{{ t('language.title') }}</h2>
              <p>{{ t('language.description') }}</p>
              <LanguageSwitcher class="mt-3" />
            </div>
          </v-card>
          <v-card tag="section" variant="outlined" class="settings-card">
            <span class="settings-icon"><Icon name="cloud-outline" :size="26" /></span>
            <div>
              <h2>{{ t('settings.ossTitle') }}</h2>
              <p>
                {{ t('settings.liveDescription', { name: workspaceName }) }}
              </p>
              <div class="flex gap-2 mt-3">
                <v-btn color="primary" :disabled="busy" @click="showConnection">{{
                  t('connection.switch')
                }}</v-btn
                ><v-btn
                  v-if="mode === 'live'"
                  variant="outlined"
                  :disabled="busy"
                  @click="disconnect"
                  >{{ t('connection.disconnect') }}</v-btn
                >
              </div>
            </div>
          </v-card>
        </main>
      </div>
    </div>

    <v-dialog v-model="preferencesDialog" max-width="640" scrollable>
      <v-card class="app-dialog preferences-dialog">
        <v-card-title>{{ t('nav.settings') }}</v-card-title>
        <v-card-text><PreferencesPanel /><LanguageSwitcher /></v-card-text>
        <v-card-actions
          ><v-btn color="primary" @click="preferencesDialog = false">{{
            t('actions.close')
          }}</v-btn></v-card-actions
        >
      </v-card>
    </v-dialog>
    <v-dialog v-model="folderDialog" max-width="440" :persistent="busy"
      ><v-card class="app-dialog"
        ><v-card-title>{{ t('folder.title') }}</v-card-title
        ><v-card-text
          ><p class="dialog-description">
            {{ t('folder.description', { path: (bucket?.name || '') + '/' + prefix }) }}
          </p>
          <form @submit.prevent="submitFolder">
            <v-text-field
              v-model="folderName"
              :label="t('folder.name')"
              autofocus
              :disabled="busy"
              :error-messages="messageText(formError)"
            /></form></v-card-text
        ><v-card-actions
          ><v-btn :disabled="busy" @click="folderDialog = false">{{ t('actions.cancel') }}</v-btn
          ><v-btn color="primary" variant="flat" :loading="busy" @click="submitFolder">{{
            t('folder.create')
          }}</v-btn></v-card-actions
        ></v-card
      ></v-dialog
    >
    <v-dialog v-model="deleteDialog" max-width="440" :persistent="busy"
      ><v-card class="app-dialog"
        ><v-card-title>{{ itemCount('delete.title', selection.length) }}</v-card-title
        ><v-card-text
          ><p>{{ t('delete.description') }}</p>
          <div class="delete-file-list">
            <div v-for="key in selection" :key="key">{{ key }}</div>
          </div></v-card-text
        ><v-card-actions
          ><v-btn :disabled="busy" @click="deleteDialog = false">{{ t('actions.cancel') }}</v-btn
          ><v-btn color="error" variant="flat" :loading="busy" @click="submitDelete">{{
            t('delete.confirm')
          }}</v-btn></v-card-actions
        ></v-card
      ></v-dialog
    >
    <v-dialog v-model="connectionDialog" max-width="720" :persistent="busy">
      <v-card class="connection-card">
        <ConnectionForm
          v-if="connectionDialog"
          :connect="connect"
          :active-id="activeConnectionId"
          :busy="busy"
          cancellable
          @connected="connectionDialog = false"
          @cancel="connectionDialog = false"
        />
      </v-card>
    </v-dialog>
    <v-dialog v-model="helpDialog" max-width="530"
      ><v-card class="app-dialog"
        ><v-card-title>{{ t('help.title') }}</v-card-title
        ><v-card-text class="help-content"
          ><h3>{{ t('help.startTitle') }}</h3>
          <p>{{ t('help.start') }}</p>
          <h3>{{ t('help.connectTitle') }}</h3>
          <p>{{ t('help.connect') }}</p>
          <h3>{{ t('help.scopeTitle') }}</h3>
          <p>{{ t('help.scope') }}</p>
          <h3>{{ t('help.shortcutsTitle') }}</h3>
          <p>{{ t('help.shortcuts') }}</p></v-card-text
        ><v-card-actions
          ><v-btn color="primary" variant="flat" @click="helpDialog = false">{{
            t('help.explore')
          }}</v-btn></v-card-actions
        ></v-card
      ></v-dialog
    >
    <v-snackbar
      :model-value="!!toast"
      @update:model-value="toast = ''"
      :timeout="4500"
      color="#293b34"
      >{{ messageText(toast)
      }}<template #actions
        ><v-btn variant="text" @click="toast = ''">{{ t('actions.close') }}</v-btn></template
      ></v-snackbar
    >
  </v-app>
</template>
