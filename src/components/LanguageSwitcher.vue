<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { supportedLocales, localePreference, setLocale } from '../i18n/index.js'
import Icon from './AppIcon.vue'
const props = defineProps({ compact: Boolean })
const { t } = useI18n()
const languages = computed(() => [
  { title: t('language.system'), value: 'system' },
  ...supportedLocales.map((language) => ({
    title: props.compact ? language.shortLabel : language.label,
    value: language.value,
  })),
])
</script>

<template>
  <v-select
    class="language-switcher"
    :class="{ compact }"
    :model-value="localePreference"
    :items="languages"
    :aria-label="t('language.select')"
    hide-details
    @update:model-value="setLocale($event)"
  >
    <template #prepend-inner><Icon name="translate" :size="17" /></template>
  </v-select>
</template>
