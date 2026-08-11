'use client';

/**
 * The "Bancos" panel's one interactive piece: the button that opens the connect
 * form in a modal. The list of connected banks is server-rendered above it; this
 * only owns the add flow, so a page with a bank already connected still renders
 * and reads without any client JS having run.
 *
 * It is handed every supported bank and passes them whole to the form, which
 * opens with a bank picker — one bank today (Banesco), but nothing here names it.
 */
import { useState } from 'react';

import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog.tsx';
import type { SupportedBank } from '../../../application/banking/list-supported-banks.ts';
import { Icon } from '../../_components/icon.tsx';
import { ConnectWizard } from './connect-wizard.tsx';
import type { ConnectState } from './form-state.ts';

type BanksPanelProps = {
  /** Every bank a company can connect. Passed whole; the form picks one. */
  banks: readonly SupportedBank[];
  /** Whether the company already has one, which changes the button copy. */
  hasAccount: boolean;
  /** The admin panel passes its own connect action + the target company to set a
   *  company up; omit them for a company's own /banks page. */
  connectAction?: (previous: ConnectState, form: FormData) => Promise<ConnectState>;
  companyId?: string;
};

export function BanksPanel({ banks, hasAccount, connectAction, companyId }: BanksPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="h-10">
          <Icon name="plus" />
          {hasAccount ? 'Conectar otro banco' : 'Conectar banco'}
        </Button>
      </DialogTrigger>

      <DialogContent className="w-[min(480px,calc(100%-2rem))]">
        <ConnectWizard
          banks={banks}
          onClose={() => setOpen(false)}
          connectAction={connectAction}
          companyId={companyId}
        />
      </DialogContent>
    </Dialog>
  );
}
