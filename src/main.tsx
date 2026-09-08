import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initialLocaleReady } from './i18n'

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

// Locale dictionaries are fetched per locale rather than bundled into the entry
// chunk, so the one this visit needs may still be in flight. Waiting for it
// costs a non-English user one request before first paint and saves everyone
// the other three dictionaries; an English user waits for nothing, since there
// is no dictionary to fetch. It never rejects — a failed load resolves and the
// app draws in English.
void initialLocaleReady.then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
