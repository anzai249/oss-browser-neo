<script setup>
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { messageText } from '../i18n/index.js'
import { desktop } from '../services/oss.js'
import { useConnectionForm } from '../composables/useConnectionForm.js'
import Icon from './AppIcon.vue'

const props = defineProps({
  connect: { type: Function, required: true },
  busy: Boolean,
  cancellable: Boolean,
  activeId: { type: String, default: null },
})
const emit = defineEmits(['connected', 'cancel'])
const { t } = useI18n()
const {
  profiles,
  saving,
  submitting,
  cleanupPending,
  deleteTarget,
  newConnection,
  requestForget,
  save,
  credentials,
  remember,
  saved,
  useSaved,
  checking,
  clearing,
  loadError,
  formError,
  notice,
  locked,
  restore,
  loadSaved,
  changeCredentials,
  forget,
  submit,
} = useConnectionForm({
  connect: (...args) => props.connect(...args),
  busy: () => props.busy,
  activeId: () => props.activeId,
  onConnected: () => emit('connected'),
})
const regions = computed(() =>
  Object.keys({
    'cn-hangzhou': 1,
    'cn-shanghai': 1,
    'cn-beijing': 1,
    'cn-shenzhen': 1,
    'cn-hongkong': 1,
    'ap-southeast-1': 1,
    'ap-southeast-2': 1,
    'us-west-1': 1,
    'eu-central-1': 1,
  }).map((value) => ({ title: t(`regions.${value}`), value })),
)

onMounted(() => loadSaved())
</script>

<template>
  <div class="connection-manager" :class="{ 'has-profiles': profiles.length }">
    <aside v-if="profiles.length" class="connection-list">
      <div class="connection-list-heading">
        <strong>{{ t('connection.manage') }}</strong
        ><v-btn
          size="small"
          variant="text"
          :disabled="locked"
          :aria-label="t('connection.add')"
          @click="newConnection"
          ><Icon name="plus" :size="18"
        /></v-btn>
      </div>
      <v-list nav class="connection-profiles" :aria-label="t('connection.manage')">
        <v-list-item
          role="button"
          v-for="profile in profiles"
          :key="profile.id"
          class="connection-profile"
          :active="saved?.id === profile.id"
          :disabled="locked"
          @click="restore(profile)"
        >
          <div class="connection-profile-title">
            {{ profile.name || profile.bucket || profile.accessKeyId }}
          </div>
          <v-chip v-if="profile.id === activeId" size="x-small" color="secondary">{{
            t('connection.current')
          }}</v-chip>
          <div class="connection-profile-meta">
            {{ profile.bucket || t('connection.allBuckets') }}
          </div>
          <div class="connection-profile-meta">
            {{ profile.region }} · {{ profile.accessKeyId }}
          </div>
        </v-list-item>
      </v-list>
    </aside>
    <form class="connection-form" @submit.prevent="submit">
      <div class="connection-form-heading">
        <span class="dialog-brand"><Icon name="cloud-outline" :size="24" /></span>
        <div>
          <h1>{{ t(saved ? 'connection.edit' : 'connection.title') }}</h1>
          <p>{{ t('connection.description') }}</p>
        </div>
      </div>
      <v-alert v-if="!desktop" type="info" variant="tonal" density="compact">{{
        t('connection.desktopOnly')
      }}</v-alert>
      <v-progress-linear
        v-if="checking"
        indeterminate
        color="primary"
        :aria-label="t('connection.loading')"
      />
      <v-alert v-if="loadError" type="warning" variant="tonal" density="compact">
        {{ messageText(loadError) }}
        <v-btn variant="text" size="small" :disabled="locked" @click="loadSaved(saved?.id)">{{
          t('actions.retry')
        }}</v-btn>
      </v-alert>
      <v-alert v-if="cleanupPending" type="warning" variant="tonal" density="compact"
        >{{ t('connection.cleanupPending')
        }}<v-btn size="small" variant="text" :disabled="locked" @click="loadSaved(saved?.id)">{{
          t('actions.retry')
        }}</v-btn></v-alert
      >
      <div v-if="saved" class="saved-connection">
        <Icon name="shield-check-outline" :size="20" />
        <div>
          <strong>{{ t(useSaved ? 'connection.saved' : 'connection.savedAvailable') }}</strong
          ><small>{{ saved.name || saved.accessKeyId }}</small>
        </div>
        <v-btn
          v-if="useSaved"
          size="small"
          variant="text"
          :disabled="locked"
          @click="changeCredentials"
          >{{ t('connection.changeCredentials') }}</v-btn
        >
        <v-btn v-else size="small" variant="text" :disabled="locked" @click="restore(saved)">{{
          t('connection.useSaved')
        }}</v-btn>
      </div>
      <fieldset :disabled="locked">
        <div class="connection-fields">
          <v-text-field
            v-model="credentials.name"
            :label="t('connection.name')"
            :placeholder="t('connection.namePlaceholder')"
            :disabled="locked"
            hide-details
          />
          <v-select
            v-model="credentials.region"
            :items="regions"
            :label="t('connection.region')"
            :disabled="locked"
            hide-details
          />
          <v-text-field
            v-model="credentials.bucket"
            class="connection-full"
            :label="t('connection.bucket')"
            :hint="t('connection.bucketHint')"
            :disabled="locked"
            persistent-hint
          />
          <v-text-field
            v-model="credentials.accessKeyId"
            class="connection-full"
            :label="t('connection.accessKeyId')"
            :disabled="locked || useSaved"
            autocomplete="off"
            autocapitalize="off"
            :spellcheck="false"
            hide-details
          />
          <template v-if="!useSaved">
            <v-text-field
              v-model="credentials.accessKeySecret"
              class="connection-full"
              :label="t('connection.accessKeySecret')"
              type="password"
              autocomplete="new-password"
              :disabled="locked"
              hide-details
            />
            <v-text-field
              v-model="credentials.securityToken"
              class="connection-full"
              :label="t('connection.token')"
              type="password"
              autocomplete="off"
              :disabled="locked"
              hide-details
            />
          </template>
        </div>
        <div class="remember-connection">
          <v-switch
            v-model="remember"
            color="primary"
            :label="t('connection.remember')"
            :disabled="locked || !desktop"
            hide-details
            density="compact"
          />
          <p>{{ t(remember ? 'connection.rememberHint' : 'connection.sessionHint') }}</p>
        </div>
      </fieldset>
      <v-alert v-if="formError" type="error" variant="tonal" density="compact" role="alert">{{
        messageText(formError)
      }}</v-alert>
      <p v-if="notice" class="connection-notice" role="status">{{ t(notice) }}</p>
      <div class="connection-form-actions">
        <v-btn
          v-if="saved"
          variant="text"
          size="small"
          color="error"
          :disabled="locked"
          :loading="clearing"
          @click="requestForget()"
          >{{ t('connection.forget') }}</v-btn
        >
        <span class="flex-1"></span>
        <v-btn v-if="cancellable" variant="text" :disabled="locked" @click="emit('cancel')">{{
          t('actions.cancel')
        }}</v-btn>
        <v-btn variant="outlined" :disabled="!desktop || locked" :loading="saving" @click="save">{{
          t('connection.saveOnly')
        }}</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          type="submit"
          :loading="busy || submitting"
          :disabled="!desktop || checking || clearing || saving || submitting"
          >{{ t('connection.submit') }}<Icon name="arrow-right" :size="16" class="ml-2"
        /></v-btn>
      </div>
    </form>
    <v-dialog
      :model-value="!!deleteTarget"
      max-width="420"
      :persistent="clearing"
      @update:model-value="!$event && (deleteTarget = null)"
    >
      <v-card class="app-dialog"
        ><v-card-title>{{ t('connection.deleteTitle') }}</v-card-title
        ><v-card-text
          ><p>
            {{
              t('connection.deleteDescription', {
                name: deleteTarget?.name || deleteTarget?.bucket || deleteTarget?.accessKeyId || '',
              })
            }}
          </p>
          <v-alert v-if="formError" type="error" variant="tonal" density="compact" class="mt-3">{{
            messageText(formError)
          }}</v-alert></v-card-text
        ><v-card-actions
          ><v-btn :disabled="clearing" @click="deleteTarget = null">{{ t('actions.cancel') }}</v-btn
          ><v-btn color="error" variant="flat" :loading="clearing" @click="forget">{{
            t('actions.delete')
          }}</v-btn></v-card-actions
        ></v-card
      >
    </v-dialog>
  </div>
</template>
