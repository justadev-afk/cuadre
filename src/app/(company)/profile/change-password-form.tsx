'use client';

import { useActionState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Icon } from '../../_components/icon.tsx';
import { changePasswordAction } from './actions.ts';
import { CHANGE_PASSWORD_INITIAL } from './form-state.ts';

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, CHANGE_PASSWORD_INITIAL);

  return (
    <form action={action} className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pw-current">Contraseña actual</Label>
        <Input
          id="pw-current"
          name="current"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pw-next">Nueva contraseña</Label>
        <Input
          id="pw-next"
          name="next"
          type="password"
          autoComplete="new-password"
          placeholder="Mínimo 8 caracteres"
          required
        />
      </div>

      {state.error !== null && (
        <Alert>
          <Icon name="warning-circle" />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={pending}>
          Guardar
        </Button>
      </div>
    </form>
  );
}
