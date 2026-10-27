import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Keep the standalone repository buildable without a parent suite's scripts.
const appUrl = new URL(JSON.parse(readFileSync(new URL('./plugin.json', import.meta.url), 'utf8')).entrypoint.url)
const port = Number(process.env.PURESCIENCE_APP_DEV_PORT || appUrl.port)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid app development port')

export default defineConfig({
  plugins: [
    react({
      plugins: [
        [
          '@swc/plugin-styled-components',
          { displayName: true, fileName: true },
        ],
      ],
    }),
  ],
  server: {
    host: appUrl.hostname,
    port,
    strictPort: true,
    fs: {
      // SDK packages may be symlinked from a compatible suite checkout.
      allow: [
        fileURLToPath(new URL('.', import.meta.url)),
        dirname(fileURLToPath(import.meta.resolve('@purescience/platform-ui'))),
        dirname(dirname(fileURLToPath(import.meta.resolve('@purescience/platform-bridge/client')))),
      ],
    },
  },
})
