import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { Toaster } from '../components/ui/sonner.tsx';
import { brandIcon, faviconIco } from './_lib/brand.ts';
import './globals.css';

export const metadata: Metadata = {
  // The brand lives here (and in the manifest), once. This is the fallback title
  // for a route that sets none; a page contributes only its own subtitle through
  // `pageMeta`, which overrides this outright. Deliberately a plain string, not a
  // `{ template }` — nothing is ever appended, so "Cuadre" never doubles in a
  // title bar. See `_lib/page-meta.ts`.
  title: 'Cuadre',
  description: 'Validación automática de pago móvil',
  applicationName: 'Cuadre',
  // The manifest route exists at `/manifest.webmanifest`, but nothing links to
  // it unless it is declared here — without this line the PWA is not
  // installable and none of its icons are ever fetched.
  manifest: '/manifest.webmanifest',
  // Two marks, one family: `icon.svg` (the tricolour tablet with the
  // confirmation check) is the app icon, and `favicon.svg` is the same idea
  // redrawn for 16px, where the camera, the home bar and the badge would only
  // turn to mush. The `.ico` carries 16/32/48 for the browsers that still ask
  // for it by path. Every one of them is versioned — see `_lib/brand.ts`.
  icons: {
    icon: [
      { url: brandIcon('favicon.svg'), type: 'image/svg+xml' },
      { url: faviconIco(), sizes: '48x48' },
    ],
    // iOS rounds the touch icon itself, so that PNG is square and opaque.
    apple: { url: brandIcon('apple-touch-icon.png'), sizes: '180x180' },
  },
  appleWebApp: { capable: true, title: 'Cuadre', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = {
  themeColor: '#161826',
  width: 'device-width',
  initialScale: 1,
  // The checkout screen is used one-handed on a phone at a counter. Letting it
  // zoom is the difference between a mis-tap and a mis-charged customer, so
  // the scale is fixed but never below 1 — text stays at system size.
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <head>
        {/* Phosphor, self-hosted would be better; on the CDN until the icon
            subset is pinned. The design system specifies this family. */}
        <link
          rel="stylesheet"
          href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css"
        />
      </head>
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
