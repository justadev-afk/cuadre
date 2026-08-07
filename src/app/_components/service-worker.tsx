'use client';

/**
 * Registers the app-shell service worker.
 *
 * It renders nothing and it registers nothing that caches a financial read —
 * `public/sw.js` only ever answers for hashed build assets and the icons, and
 * the reason is written there. This component's only job is to keep the
 * registration off the critical path: it waits for `load`, so installing the
 * worker never competes with the first paint of a checkout screen.
 */

import { useEffect } from 'react';

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const register = () => {
      // A registration that fails leaves a perfectly working app. There is
      // nothing for the person at the counter to do about it, so it is not
      // worth an unhandled rejection in their console.
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
    };

    if (document.readyState === 'complete') {
      register();
      return;
    }

    window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
