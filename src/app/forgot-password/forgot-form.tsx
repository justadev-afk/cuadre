'use client';

/**
 * Screen 04's form. Client so the "revisa tu correo" confirmation replaces the
 * field in place — the same answer whether or not the address was found.
 */
import { useActionState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Icon } from '../_components/icon.tsx';
import { requestResetAction } from './actions.ts';
import { FORGOT_INITIAL } from './form-state.ts';

export function ForgotForm() {
  const [state, action, pending] = useActionState(requestResetAction, FORGOT_INITIAL);

  if (state.done) {
    return (
      <Alert>
        <Icon name="check-circle" />
        <AlertDescription>
          Si ese correo tiene una cuenta, le enviamos un enlace para crear una contraseña nueva.
          Vence en 30 minutos.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="forgot-email">Correo de la cuenta</Label>
        <Input
          id="forgot-email"
          name="email"
          type="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="tu@empresa.com"
          className="h-10"
          required
        />
      </div>

      {state.error !== null && (
        <Alert>
          <Icon name="warning-circle" />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" size="block" className="mt-1 h-10" disabled={pending}>
        Enviar enlace
      </Button>
    </form>
  );
}
