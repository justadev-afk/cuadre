'use client';

/**
 * The new-password form. The token is a hidden field, carried from the URL the
 * mail linked to; the endpoint reads it there.
 *
 * The device id rides along for the same reason it does on the login form: this
 * opens a session, and a session with no device on it cannot tell "signed in on
 * another device" from "signed in again on this one".
 *
 * `refresh: false` because this form never comes back to itself: it either
 * refuses, or it navigates to wherever the session it just opened belongs.
 */
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { PASSWORD_MIN_LENGTH } from '../../../domain/credentials.ts';
import { Icon } from '../../_components/icon.tsx';
import { DeviceIdField } from '../../_lib/device-id-field.tsx';
import { API } from '../../_lib/endpoints.ts';
import { useEndpointAction } from '../../_lib/use-endpoint-action.ts';
import { RESET_INITIAL, type ResetState } from './form-state.ts';

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useEndpointAction<ResetState>(API.resetPassword, RESET_INITIAL, {
    refresh: false,
  });

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      <DeviceIdField />

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reset-password">Nueva contraseña</Label>
          <Input
            id="reset-password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder={`Mínimo ${PASSWORD_MIN_LENGTH} caracteres`}
            minLength={PASSWORD_MIN_LENGTH}
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
            minLength={PASSWORD_MIN_LENGTH}
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
        Guardar y entrar
      </Button>
    </form>
  );
}
