'use client';

import type { CSSProperties } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

import { Icon } from '@/app/_components/icon.tsx';

/**
 * The one fixed toast overlay, mounted once in the root layout. It wraps
 * `sonner` and dresses it in Nocturne: the surface fill, a danger ring on
 * errors, and the Phosphor icon per tone. A failed action shows here, never as
 * a block that resizes the dialog that raised it.
 */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      position="bottom-right"
      className="toaster group"
      icons={{
        success: <Icon name="check-circle" className="text-primary" />,
        info: <Icon name="info" className="text-primary" />,
        warning: <Icon name="warning-circle" className="text-primary" />,
        error: <Icon name="warning-circle" className="text-destructive" />,
      }}
      style={
        {
          '--normal-bg': 'var(--card)',
          '--normal-text': 'var(--foreground)',
          '--normal-border': 'var(--border)',
          '--success-bg': 'var(--card)',
          '--success-text': 'var(--foreground)',
          '--success-border': 'var(--border)',
          '--error-bg': 'var(--card)',
          '--error-text': 'var(--foreground)',
          '--error-border': 'color-mix(in srgb, var(--destructive) 55%, transparent)',
        } as CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: 'font-sans !text-[13px] !shadow-[var(--shadow-md)]',
          description: '!text-muted-foreground',
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
