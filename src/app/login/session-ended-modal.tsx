'use client';

/**
 * The notice shown at `/login?ended=other-device`: the session was closed
 * because the same user signed in on another device.
 *
 * By the time this renders the cookie is already cleared (the `/session-ended`
 * route did it before forwarding here), so this is purely an explanation — it
 * dismisses to reveal the login form underneath.
 */

import { useState } from 'react';

import { Button } from '@/components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { Icon } from '../_components/icon.tsx';

export function SessionEndedModal() {
  const [open, setOpen] = useState(true);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="w-[min(420px,calc(100%-2rem))]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-full bg-primary/[0.12] text-xl text-primary">
              <Icon name="sign-out" />
            </span>
            <DialogTitle className="text-[19px]">Se cerró tu sesión</DialogTitle>
          </div>
          <DialogDescription className="pt-1 text-sm text-foreground/85">
            Tu sesión se cerró porque iniciaste sesión en otro dispositivo.
          </DialogDescription>
        </DialogHeader>

        <Button size="block" className="h-10" onClick={() => setOpen(false)}>
          Entendido
        </Button>
      </DialogContent>
    </Dialog>
  );
}
