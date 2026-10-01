'use client';

/**
 * "Probar" — asks the bank, right now, whether this connection's stored
 * credentials still open a session. No dialog: nothing is typed and nothing is
 * at risk, so one press answers with a toast. A refusal's toast carries the
 * bank's diagnostic (`banesco prd · token · HTTP 401 · invalid_grant`), which is
 * the line a merchant reads out to the bank's desk.
 *
 * Rendered on the company panel and the admin's company page only — the till
 * never draws it, and the endpoint refuses a cashier anyway.
 */
import { useEffect } from 'react';

import { Button } from '@/components/ui/button.tsx';
import { Icon } from '../../_components/icon.tsx';
import { API } from '../../_lib/endpoints.ts';
import { toast } from '../../_lib/toast.ts';
import { useEndpointAction } from '../../_lib/use-endpoint-action.ts';
import { TEST_CREDENTIALS_INITIAL, type TestCredentialsState } from './form-state.ts';

export function TestCredentialsButton({
  accountId,
  companyId,
  bankLabel,
}: {
  accountId: string;
  /** The target company, for the admin flow; omitted for the company's own. */
  companyId?: string;
  bankLabel: string;
}) {
  const [state, action, pending] = useEndpointAction<TestCredentialsState>(
    API.banksTest,
    TEST_CREDENTIALS_INITIAL,
  );

  // Not `useActionOutcome`: that one fires its success on `ok` *changing*, and
  // pressing "Probar" twice must answer twice, so both tones key on the state.
  useEffect(() => {
    if (state.ok) toast(`${bankLabel} aceptó las credenciales.`, 'success');
    else if (state.error) toast(state.error);
  }, [state, bankLabel]);

  return (
    <form action={action}>
      <input type="hidden" name="accountId" value={accountId} />
      {companyId !== undefined && <input type="hidden" name="companyId" value={companyId} />}
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        <Icon name="plugs-connected" />
        {pending ? 'Probando…' : 'Probar'}
      </Button>
    </form>
  );
}
