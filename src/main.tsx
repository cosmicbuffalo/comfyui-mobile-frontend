import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Register the push service worker. Harmless without a subscription; it just
// needs to be active so the user can opt into notifications. Only works in a
// secure context (HTTPS / installed PWA) — failures are expected over plain HTTP.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/mobile/sw.js', { scope: '/mobile/' })
      .catch((err) => console.warn('Service worker registration failed:', err));
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
