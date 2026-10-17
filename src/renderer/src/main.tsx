import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

// sync, so platform-specific chrome (traffic-light inset, overlay padding) is right on first paint
document.documentElement.dataset.platform = /Mac/.test(navigator.userAgent)
  ? 'darwin'
  : /Windows/.test(navigator.userAgent)
    ? 'win32'
    : 'linux'

// dev-only in-memory backend; the constant guard drops the module from production builds
if (import.meta.env.VITE_MOCK === '1') await (await import('./mock')).install()

// biome-ignore lint/style/noNonNullAssertion: index.html always ships #root
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
