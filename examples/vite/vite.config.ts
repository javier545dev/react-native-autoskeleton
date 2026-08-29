import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// tasks.md 7.1: `@tailwindcss/vite` is the Tailwind v4 first-party plugin —
// the same compiler `test/web/helpers/tailwind.ts` drives through the CLI, so
// the compiler-contract suite and this app's production build cannot drift
// apart on the `@theme` handling both depend on.
// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
})
