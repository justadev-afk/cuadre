'use client';

/**
 * "¿Cerrar sesión?" — the one question every exit asks, wherever the button is.
 *
 * Four surfaces sign somebody out: the sidebar's icon, the phone bar's icon, the
 * express till's *Salir* and the profile screen's full-width button. All four
 * used to post to `/logout` on the first click, and two of them are an icon the
 * size of a thumb next to something a cashier taps all day — a mis-tap ended a
 * shift, and the way back is a company id, a username and a PIN with a customer
 * waiting.
 *
 * So the question lives here once and the *clothes* stay the caller's (§11):
 * whatever is passed as `children` becomes the trigger, unchanged, and only the
 * confirm inside this dialog posts. The post is still a plain `<form>` — the
 * route wants a POST it can answer with a redirect and a cleared cookie, and
 * nothing here needs to be told how that went.
 *
 * Small and centred, no close ✕: the two answers are the two buttons, and
 * *Cancelar* comes first in the DOM so it is what focus lands on and what Enter
 * takes — the safe answer should be the accidental one. Escape and the backdrop
 * also mean cancel, which Radix already gives us.
 */
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button.tsx';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog.tsx';

export function SignOut({ children }: { children: ReactNode }) {
  return (
    <Dialog>
      {/* `asChild`: the trigger *is* the caller's button — an icon in the rail,
          a block button on the profile screen — never a second one wrapped
          around it. */}
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="w-[min(340px,calc(100%-2rem))]" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-lg">¿Cerrar sesión?</DialogTitle>
          <DialogDescription>Tendrás que entrar otra vez para seguir en Cuadre.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              Cancelar
            </Button>
          </DialogClose>
          <form action="/logout" method="post">
            <Button type="submit">Cerrar sesión</Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
