import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// tasks.md 7.1: Tailwind v4 entry stylesheet — the sole source of this app's
// skeleton colours (see src/tailwind-theme.css).
import './tailwind-theme.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
