'use client';

/**
 * The admin sign-in form. Client only so the refusal can be shown in place —
 * a wrong password on an unlinked route should not become a URL somebody can
 * be handed.
 *
 * The fields are controlled so a refusal keeps the email; on error only the
 * password is cleared and the cursor returns to the email, the same courtesy
 * the merchant and cashier forms give.
 */

import { useEffect, useRef, useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Icon } from '../../_components/icon.tsx';
import { DeviceIdField } from '../../_lib/device-id-field.tsx';
import { API } from '../../_lib/endpoints.ts';
import { NO_SIGN_IN_ERROR, type SignInState } from '../../_lib/sign-in-state.ts';
import { useEndpointAction } from '../../_lib/use-endpoint-action.ts';

export function AdminLoginForm() {
  const [state, action, pending] = useEndpointAction<SignInState>(
    API.signInAdmin,
    NO_SIGN_IN_ERROR,
    { refresh: false },
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.error !== null) {
      setPassword('');
      emailRef.current?.focus();
    }
  }, [state]);

  return (
    <form action={action} className="flex flex-col gap-3">
      <DeviceIdField />
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="admin-email">Correo corporativo</Label>
          <Input
            ref={emailRef}
            id="admin-email"
            name="email"
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            className="h-10"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="admin-password">Contraseña</Label>
          <Input
            id="admin-password"
            name="password"
            type="password"
            autoComplete="current-password"
            className="h-10"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
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

      <Button type="submit" size="block" className="mt-2 h-10" disabled={pending}>
        Entrar
      </Button>
    </form>
  );
}
