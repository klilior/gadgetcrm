import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'

// A background read of a record that was removed/replaced (e.g. by a Linet sync)
// can reject with a 404 that no caller is awaiting. These are non-fatal — log the
// exact request for reference, then prevent the opaque overlay from interrupting the user.
// Low-level tap: record the URL of every 404 network response at the XHR layer,
// before any library handles it. This finally tells us WHICH request is 404ing,
// even when the reported AxiosError has no config/URL attached.
window.__last404s = window.__last404s || [];
const __origXhrOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (method, url, ...rest) {
  this.addEventListener('loadend', () => {
    if (this.status === 404) {
      const entry = { method: String(method || 'GET').toUpperCase(), url: String(url || ''), at: new Date().toISOString() };
      window.__last404s.push(entry);
      if (window.__last404s.length > 20) window.__last404s.shift();
      console.warn(`[404 network tap] ${entry.method} ${entry.url}`);
    }
  });
  return __origXhrOpen.call(this, method, url, ...rest);
};

window.addEventListener('unhandledrejection', (event) => {
  const err = event?.reason;
  const cfg = err?.config;
  const status = err?.response?.status;
  // A 404 from any background request means a record simply wasn't there — never
  // fatal to this app. Log it (with the URL when available) for reference, then
  // prevent the opaque error overlay from interrupting the user.
  if (status === 404) {
    // Non-fatal: a background read hit a record that isn't there. Use console.warn
    // (not console.error) so it doesn't get surfaced as a reported app error, and
    // swallow the rejection so no overlay interrupts the user.
    console.warn(
      `[background 404 — handled] ` +
      `${(cfg?.method || 'get').toUpperCase()} ${cfg?.baseURL || ''}${cfg?.url || '(url unavailable)'}`,
      err?.response?.data || err?.message
    );
    event.preventDefault();
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