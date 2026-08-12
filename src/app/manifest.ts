import type { MetadataRoute } from 'next';

import { brandIcon } from './_lib/brand.ts';

/**
 * The PWA manifest, served at `/manifest.webmanifest`.
 *
 * `start_url` is `/checkout-express`: the cashier is who installs Cuadre, and
 * the installed app is their whole world — the sidebar-less express till, not
 * the shell. A browser tab is the other surface (it opens `/checkout`); the
 * express till is the PWA's, so the app reopens straight there rather than on
 * the shell. The colours are Nocturne's ground so the splash and the status bar
 * match the first paint. Icons are served from the Worker's own `public/`,
 * never a CDN, and carry `?v=` (`_lib/brand.ts`) — an installed app only picks
 * up new artwork when this document changes, and it does not change when the
 * bytes behind an unchanged URL do.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Cuadre',
    short_name: 'Cuadre',
    description: 'Confirma un pago móvil en el mostrador, con la respuesta del banco.',
    start_url: '/checkout-express',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#161826',
    theme_color: '#161826',
    lang: 'es-VE',
    icons: [
      { src: brandIcon('192.png'), sizes: '192x192', type: 'image/png' },
      { src: brandIcon('512.png'), sizes: '512x512', type: 'image/png' },
      { src: brandIcon('maskable.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [{ name: 'Mis validaciones', url: '/my-validations' }],
  };
}
