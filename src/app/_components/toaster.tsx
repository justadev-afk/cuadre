'use client';

/**
 * The one fixed overlay that renders toasts, mounted once in the root layout.
 * Everything else raises a toast through the module bus (`_lib/toast.ts`), so a
 * failed action shows here instead of growing a block inside a dialog.
 */
import { useEffect, useState } from 'react';

import { dismissToast, subscribeToasts, type Toast } from '../_lib/toast.ts';
import { Icon } from './icon.tsx';

export function Toaster() {
  const [toasts, setToasts] = useState<readonly Toast[]>([]);
  useEffect(() => subscribeToasts(setToasts), []);

  if (toasts.length === 0) return null;

  return (
    <div className="toaster">
      {toasts.map((entry) => (
        <div key={entry.id} className={`toast toast-${entry.tone}`} role="status">
          <Icon name={entry.tone === 'success' ? 'check-circle' : 'warning-circle'} />
          <span style={{ flex: 1 }}>{entry.message}</span>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            aria-label="Cerrar"
            onClick={() => dismissToast(entry.id)}
          >
            <Icon name="x" />
          </button>
        </div>
      ))}
    </div>
  );
}
