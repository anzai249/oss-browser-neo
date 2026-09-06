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
  VTextarea,
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
  VDivider,
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
    VTextarea,
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
    VDivider,
  },
  directives: { Ripple },
  theme: {
    defaultTheme: 'system',
    themes: {
      light: {
        dark: false,
        colors: {
          primary: '#eb6b35',
          secondary: '#426c62',
          background: '#f6f7f9',
          surface: '#ffffff',
          'surface-variant': '#edf1ee',
          'on-background': '#29332f',
          'on-surface': '#29332f',
          'on-surface-variant': '#52605a',
          outline: '#89938e',
          success: '#39745f',
          warning: '#a86b1f',
          info: '#426c91',
          error: '#c74343',
        },
      },
      dark: {
        dark: true,
        colors: {
          primary: '#ffab82',
          secondary: '#91c9b9',
          background: '#101512',
          surface: '#181f1b',
          'surface-variant': '#252e29',
          'on-background': '#e2e9e4',
          'on-surface': '#e2e9e4',
          'on-surface-variant': '#bdc8c1',
          outline: '#89938d',
          success: '#82c8aa',
          warning: '#efbd70',
          info: '#9dc7ee',
          error: '#ffb4ab',
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
