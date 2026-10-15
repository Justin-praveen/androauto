// Runs the UI alone in a browser against a mock backend (src/renderer/src/lib/mock-api.ts).
// Handy for working on screens without Electron or a phone: npm run ui:preview
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: 'src/renderer',
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  plugins: [react(), tailwindcss()]
})
