'use client';

/**
 * The new-password form. The token is a hidden field, carried from the URL the
 * mail linked to; the action reads it there.
 */
import { useActionState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Icon } from '../../_components/icon.tsx';
import { resetPasswordAction } from './actions.ts';
import { RESET_INITIAL } from './form-state.ts';

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, RESET_INITIAL);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reset-password">Nueva contraseña</Label>
          <Input
            id="reset-password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="Mínimo 8 caracteres"
            className="h-10"
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reset-confirm">Repite la contraseña</Label>
          <Input
            id="reset-confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            className="h-10"
            required
          />
        </div>
      </div>

      {state.error !== null && (
        <Alert>
          <Icon name="warning-circle" />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" size="block" className="mt-1 h-10" disabled={pending}>
        Guardar contraseña
      </Button>
    </form>
  );
}
