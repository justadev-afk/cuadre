'use client';

/**
 * The "Bancos" panel's one interactive piece: the button that opens the
 * onboarding wizard in a modal. The list of connected accounts is server-
 * rendered above it; this only owns the add flow, so a page with a bank already
 * connected still renders and reads without any client JS having run.
 */
import { useState } from 'react';

import type { BankCredentialGroup } from '../../../application/ports/bank-gateway.ts';
import { Icon } from '../../_components/icon.tsx';
import { ConnectWizard } from './connect-wizard.tsx';

type BanksPanelProps = {
  displayName: string;
  environments: readonly ('production' | 'sandbox')[];
  credentialGroups: readonly BankCredentialGroup[];
  /** Whether the company already has an account, which changes the button copy. */
  hasAccount: boolean;
};

export function BanksPanel({
  displayName,
  environments,
  credentialGroups,
  hasAccount,
}: BanksPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="btn btn-primary"
        style={{ minHeight: 40 }}
        onClick={() => setOpen(true)}
      >
        <Icon name="plus" />
        {hasAccount ? 'Conectar otra cuenta' : `Conectar ${displayName}`}
      </button>

      {open && (
        <div className="dialog-backdrop">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Conectar ${displayName}`}
            className="dialog elev-lg"
            style={{ width: 'min(480px, 96vw)', background: 'var(--color-surface)', padding: 24 }}
          >
            <ConnectWizard
              displayName={displayName}
              environments={environments}
              credentialGroups={credentialGroups}
              onClose={() => setOpen(false)}
            />
          </div>
        </div>
      )}
    </>
  );
}
