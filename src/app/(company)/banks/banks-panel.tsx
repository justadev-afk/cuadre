'use client';

/**
 * The "Bancos" panel's one interactive piece: the button that opens the
 * onboarding wizard in a modal. The list of connected accounts is server-
 * rendered above it; this only owns the add flow, so a page with a bank already
 * connected still renders and reads without any client JS having run.
 *
 * It is handed every supported bank and passes them whole to the wizard, which
 * opens with a bank picker — one bank today (Banesco), but nothing here names it.
 */
import { useState } from 'react';

import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog.tsx';
import type { SupportedBank } from '../../../application/banking/list-supported-banks.ts';
import { Icon } from '../../_components/icon.tsx';
import { ConnectWizard } from './connect-wizard.tsx';
import type { ConnectState, VerifyState } from './form-state.ts';

type BanksPanelProps = {
  /** Every bank a company can connect. Passed whole; the wizard picks one. */
  banks: readonly SupportedBank[];
  /** Whether the company already has an account, which changes the button copy. */
  hasAccount: boolean;
  /** The admin panel passes its own verify/connect actions + the target company
   *  to set a company up; omit them for a company's own /banks page. */
  verifyAction?: (previous: VerifyState, form: FormData) => Promise<VerifyState>;
  connectAction?: (previous: ConnectState, form: FormData) => Promise<ConnectState>;
  companyId?: string;
};

export function BanksPanel({
  banks,
  hasAccount,
  verifyAction,
  connectAction,
  companyId,
}: BanksPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="h-10">
          <Icon name="plus" />
          {hasAccount ? 'Conectar otra cuenta' : 'Conectar banco'}
        </Button>
      </DialogTrigger>

      <DialogContent className="w-[min(480px,calc(100%-2rem))]">
        <ConnectWizard
          banks={banks}
          onClose={() => setOpen(false)}
          verifyAction={verifyAction}
          connectAction={connectAction}
          companyId={companyId}
        />
      </DialogContent>
    </Dialog>
  );
}
