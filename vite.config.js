import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import statementAssets from './statementAssets.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), statementAssets()],
})
