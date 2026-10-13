// npm run dev: mock upstreams, the server on the example config (restarted when src/ changes), and Vite in front of it on
// PORT (3000) with hot reload of the page. Builtin plugins and the config folder hot-reload without a restart.
// `node dev/dev.js examples/showcase` (npm run dev:showcase) runs another config folder the same way.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { startMocks } from './mock-upstreams.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const port = Number(process.env.PORT ?? 3000)
// The server listens next to Vite; the browser only talks to Vite, which passes the server's paths on.
const backend = port + 1
await startMocks({ hostKeyFile: `${root}.dev-data/mock-ssh-host-key` })

const child = spawn(process.execPath, [
  '--watch-path=src',
  'bin/homelabdash.js', 'serve',
  '--config-dir', process.argv[2] ?? 'examples/config',
  '--data-dir', '.dev-data',
  '--host', '127.0.0.1',
  '--port', String(backend),
  '--watch-builtin'
], { cwd: root, stdio: 'inherit' })

const target = `http://127.0.0.1:${backend}`
const vite = await createServer({
  configFile: `${root}vite.config.js`,
  server: {
    port,
    strictPort: true,
    // changeOrigin stays off: the server compares Origin with Host, and both must stay the browser's.
    proxy: {
      '/api': { target, ws: true },
      '/icons': target,
      '/plugins': target,
      '/custom.css': target,
      '/custom.js': target
    }
  }
})
await vite.listen()
vite.printUrls()

const stop = async () => { child.kill(); await vite.close(); process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
child.on('exit', code => process.exit(code ?? 0))
