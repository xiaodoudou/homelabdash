import { createApp } from 'vue'
import App from './App.vue'
import './theme.css'

// custom.css from the config folder comes after the theme so it can override it; custom.js runs once the page is there.
const css = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: '/custom.css' })
css.dataset.custom = ''
document.head.append(css)

createApp(App).mount('#app')

document.body.append(Object.assign(document.createElement('script'), { type: 'module', src: '/custom.js' }))
