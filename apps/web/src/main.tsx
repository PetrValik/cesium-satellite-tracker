import { createRoot } from 'react-dom/client'
import './styles/index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(<App />)

// The service worker exists only in production builds (dist/sw.js, stamped by vite.config.ts);
// `vite dev` never registers one, so the dev loop is never served from a cache.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const register = () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch((err: unknown) => console.warn('[pwa] service worker registration failed', err))
  }
  // After load, so the precache download does not compete with the first boot.
  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}
