import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'

// Diagnostic: surface the exact request behind any unhandled axios error (e.g. opaque 404s)
window.addEventListener('unhandledrejection', (event) => {
  const err = event?.reason;
  const cfg = err?.config;
  if (cfg?.url) {
    console.error(
      `[unhandled request error] ${err?.response?.status || '?'} ` +
      `${(cfg.method || 'get').toUpperCase()} ${cfg.baseURL || ''}${cfg.url}`,
      err?.response?.data || err?.message
    );
  }
});

ReactDOM.createRoot(document.getElementById('root')).render(
  // <React.StrictMode>
  <App />
  // </React.StrictMode>,
)

if (import.meta.hot) {
  import.meta.hot.on('vite:beforeUpdate', () => {
    window.parent?.postMessage({ type: 'sandbox:beforeUpdate' }, '*');
  });
  import.meta.hot.on('vite:afterUpdate', () => {
    window.parent?.postMessage({ type: 'sandbox:afterUpdate' }, '*');
  });
}