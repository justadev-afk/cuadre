import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { Toaster } from './_components/toaster.tsx';
import './globals.css';

export const metadata: Metadata = {
  title: 'Cuadre',
  description: 'Validación automática de pago móvil',
  applicationName: 'Cuadre',
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
