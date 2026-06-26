import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'

// A background read of a record that was removed/replaced (e.g. by a Linet sync)
// can reject with a 404 that no caller is awaiting. These are non-fatal — log the
// exact request for reference, then prevent the opaque overlay from interrupting the user.
window.addEventListener('unhandledrejection', (event) => {
  const err = event?.reason;
  const cfg = err?.config;
  const status = err?.response?.status;
  if (cfg?.url) {
    console.error(
      `[unhandled request error] ${status || '?'} ` +
      `${(cfg.method || 'get').toUpperCase()} ${cfg.baseURL || ''}${cfg.url}`,
      err?.response?.data || err?.message
    );
    // Only swallow benign not-found reads on GET — everything else still surfaces.
    if (status === 404 && (cfg.method || 'get').toLowerCase() === 'get') {
      event.preventDefault();
    }
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