import { createApp } from 'vue'
import { polyfillCountryFlagEmojis } from 'country-flag-emoji-polyfill'
import flagFont from 'country-flag-emoji-polyfill/dist/TwemojiCountryFlags.woff2?url'
import App from './App.vue'
import './theme.css'

// Windows draws flag emoji as two letters (SG); where it does, a font of flags alone, served with the page, draws them
polyfillCountryFlagEmojis('Twemoji Country Flags', flagFont)

// custom.css from the config folder comes after the theme so it can override it; custom.js runs once the page is there.
const css = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/custom.css' })
css.dataset.custom = ''
document.head.append(css)

createApp(App).mount('#app')

document.body.append(Object.assign(document.createElement('script'), { type: 'module', src: '/custom.js' }))
