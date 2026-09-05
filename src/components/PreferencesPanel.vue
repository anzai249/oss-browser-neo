<script setup>
import { useI18n } from 'vue-i18n'
import {
  preferences,
  preferenceOptions,
  storageError,
  resetPreferences,
} from '../composables/usePreferences.js'
import Icon from './AppIcon.vue'
const { t } = useI18n()
</script>
<template>
  <div class="preferences-panel">
    <v-card tag="section" variant="outlined" class="settings-card">
      <span class="settings-icon"><Icon name="image-outline" :size="24" /></span>
      <div class="preference-body">
        <h2>{{ t('preferences.browsing') }}</h2>
        <div class="preference-row">
          <div>
            <strong>{{ t('preferences.imagePreview') }}</strong>
            <p>{{ t('preferences.imagePreviewHint') }}</p>
          </div>
          <v-switch
            v-model="preferences.imagePreview"
            :aria-label="t('preferences.imagePreview')"
            color="primary"
            density="compact"
            hide-details
          />
        </div>
        <div class="preference-row">
          <div>
            <strong>{{ t('preferences.pageSize') }}</strong>
            <p>{{ t('preferences.pageSizeHint') }}</p>
          </div>
          <v-select
            v-model="preferences.pageSize"
            :items="preferenceOptions.pageSize"
            :aria-label="t('preferences.pageSize')"
            hide-details
          />
        </div>
      </div>
    </v-card>
    <v-card tag="section" variant="outlined" class="settings-card">
      <span class="settings-icon"><Icon name="cloud-outline" :size="24" /></span>
      <div class="preference-body">
        <h2>{{ t('preferences.network') }}</h2>
        <div class="preference-row">
          <div>
            <strong>{{ t('preferences.timeout') }}</strong>
            <p>{{ t('preferences.timeoutHint') }}</p>
          </div>
          <v-select
            v-model="preferences.timeoutSeconds"
            :items="preferenceOptions.timeoutSeconds"
            :aria-label="t('preferences.timeout')"
            hide-details
          />
        </div>
        <div class="preference-row">
          <div>
            <strong>{{ t('preferences.retries') }}</strong>
            <p>{{ t('preferences.retriesHint') }}</p>
          </div>
          <v-select
            v-model="preferences.readRetries"
            :items="preferenceOptions.readRetries"
            :aria-label="t('preferences.retries')"
            hide-details
          />
        </div>
      </div>
    </v-card>
    <v-card tag="section" variant="outlined" class="settings-card">
      <span class="settings-icon"><Icon name="swap-vertical" :size="24" /></span>
      <div class="preference-body">
        <h2>{{ t('preferences.transfers') }}</h2>
        <div class="preference-row">
          <div>
            <strong>{{ t('preferences.historyLimit') }}</strong>
            <p>{{ t('preferences.historyHint') }}</p>
          </div>
          <v-select
            v-model="preferences.historyLimit"
            :items="preferenceOptions.historyLimit"
            :aria-label="t('preferences.historyLimit')"
            hide-details
          />
        </div>
      </div>
    </v-card>
    <v-alert v-if="storageError" type="warning" density="compact" variant="tonal">{{
      t('preferences.storageError')
    }}</v-alert>
    <div class="preferences-footer">
      <span>{{ t('preferences.saved') }}</span
      ><v-btn variant="text" size="small" @click="resetPreferences">{{
        t('preferences.reset')
      }}</v-btn>
    </div>
  </div>
</template>
