import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

try {
  registerSW({ immediate: true });
} catch {
  // Ignore if service worker registration is blocked in restricted iframe
}

try {
  const nativeFetch = window.fetch ? window.fetch.bind(window) : undefined;
  if (nativeFetch) {
    Object.defineProperty(window, 'fetch', {
      configurable: true,
      enumerable: true,
      get: () => nativeFetch,
      set: () => {
        // Ignore third-party extension attempts to overwrite window.fetch
      }
    });
  }
} catch {
  // Ignore if property is non-configurable
}

createRoot(document.getElementById('root')!).render(<App />);

