import '@fontsource/nunito/latin-400.css';
import '@fontsource/nunito/latin-600.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';
import './styles.css';
import { App } from './app/app';
const root = document.querySelector<HTMLElement>('#app');
if (root) void new App(root).init();
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // Waiting updates activate only after every old client is released. No forced reload or skipWaiting.
  void navigator.serviceWorker.register('/sw.js').then(registration => {
    const notify = () => window.dispatchEvent(new Event('runtime-update-available'));
    if (registration.waiting) notify();
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) notify();
      });
    });
  }).catch(() => undefined);
}
