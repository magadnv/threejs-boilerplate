import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base './' → der Build läuft auch aus einem Unterordner (z. B. GitHub Pages)
export default defineConfig({
  base: './',
  plugins: [react()],
})
