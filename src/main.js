import { createApp } from 'vue'
import { createVuetify } from 'vuetify'
import { aliases, mdi } from 'vuetify/iconsets/mdi-svg'
import {
  VTable,
  VCheckboxBtn,
  VBtnToggle,
  VBreadcrumbs,
  VApp,
  VBtn,
  VDialog,
  VCard,
  VCardTitle,
  VCardText,
  VCardActions,
  VTextField,
  VSelect,
  VSnackbar,
  VProgressLinear,
  VTooltip,
  VMenu,
  VList,
  VListItem,
  VSwitch,
  VChip,
  VAlert,
} from 'vuetify/components'
import { Ripple } from 'vuetify/directives'
import 'vuetify/styles'
import './style.css'
import App from './App.vue'
import { i18n } from './i18n/index.js'
import { useI18n } from 'vue-i18n'
import { createVueI18nAdapter } from 'vuetify/locale/adapters/vue-i18n'

const vuetify = createVuetify({
  locale: { adapter: createVueI18nAdapter({ i18n, useI18n }) },
  icons: { defaultSet: 'mdi', aliases, sets: { mdi } },
  components: {
    VTable,
    VCheckboxBtn,
    VBtnToggle,
    VBreadcrumbs,
    VApp,
    VBtn,
    VDialog,
    VCard,
    VCardTitle,
    VCardText,
    VCardActions,
    VTextField,
    VSelect,
    VSnackbar,
    VProgressLinear,
    VTooltip,
    VMenu,
    VList,
    VListItem,
    VSwitch,
    VChip,
    VAlert,
  },
  directives: { Ripple },
  theme: {
    defaultTheme: 'studio',
    themes: {
      studio: {
        dark: false,
        colors: {
          primary: '#eb6b35',
          secondary: '#426c62',
          background: '#f8f9fb',
          surface: '#ffffff',
          error: '#c74343',
        },
      },
    },
  },
  defaults: {
    VBtn: {
      density: 'compact',
      elevation: 0,
      style: 'text-transform:none;letter-spacing:0',
    },
    VTextField: { variant: 'outlined', density: 'compact', color: 'primary' },
    VSelect: { variant: 'outlined', density: 'compact', color: 'primary' },
    VList: { density: 'compact', color: 'primary' },
    VListItem: { color: 'primary' },
    VCheckboxBtn: { density: 'compact', color: 'primary' },
    VTable: { density: 'compact' },
  },
})
createApp(App).use(i18n).use(vuetify).mount('#app')
