import type { MetadataRoute } from 'next';

/**
 * The PWA manifest, served at `/manifest.webmanifest`.
 *
 * `start_url` is `/checkout`: the cashier is who installs Cuadre, and the app
 * should open straight at the till. The colours are Nocturne's ground so the
 * splash and the status bar match the first paint. Icons are served from the
 * Worker's own `public/`, never a CDN.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Cuadre — validación de pago móvil',
    short_name: 'Cuadre',
    description: 'Confirma un pago móvil en el mostrador, con la respuesta del banco.',
    start_url: '/checkout',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#161826',
    theme_color: '#161826',
    lang: 'es-VE',
    icons: [
      { src: '/icons/192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [{ name: 'Mis validaciones', url: '/my-validations' }],
  };
}
