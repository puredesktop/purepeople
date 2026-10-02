import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'

import { appDevServerFromManifest } from '../.packages/app-server.mjs'

export default defineConfig({
  optimizeDeps: {
    extensions: [".tsx"],
    include: ["react", "react-dom", "react-dom/client", "styled-components"],
  },
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
  server: appDevServerFromManifest(import.meta.url),
})
