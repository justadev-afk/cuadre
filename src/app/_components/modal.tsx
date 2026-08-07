'use client';

/**
 * The shared modal shell: a dim backdrop that closes on Escape or a click
 * outside the dialog, wrapping whatever `.dialog` the caller renders.
 *
 * The close fires on `mousedown` with a target check rather than `click`, so a
 * drag that begins inside the dialog (selecting text in a field) and releases on
 * the backdrop does not dismiss a form the cashier was filling — only a press
 * that both starts and ends on the backdrop counts as "clicked outside".
 */
import { type ReactNode, useEffect } from 'react';

export function ModalBackdrop({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the dialog inside owns focus and keys; this is only the click-away target, and Escape is handled above.
    <div
      className="dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {children}
    </div>
  );
}
