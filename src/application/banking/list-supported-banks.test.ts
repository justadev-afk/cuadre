import { describe, expect, it } from 'vitest';

import type { BankCredentialGroup } from '../ports/bank-gateway.ts';
import { makeListSupportedBanks } from './list-supported-banks.ts';

const GROUPS: readonly BankCredentialGroup[] = [
  {
    key: 'confirmation',
    usage: 'operate',
    label: 'Confirmación de Transacciones',
    required: true,
    fields: [
      { name: 'clientId', label: 'Client ID (OAuth 2.0)', secret: false },
      { name: 'clientSecret', label: 'Client Secret', secret: true },
    ],
  },
  {
    key: 'consulta',
    usage: 'discover',
    label: 'Consulta de Saldo',
    required: false,
    fields: [
      { name: 'clientId', label: 'Client ID (OAuth 2.0)', secret: false },
      { name: 'clientSecret', label: 'Client Secret', secret: true },
    ],
  },
];

const BANESCO = {
  id: 'banesco',
  displayName: 'Banesco',
  environments: ['production', 'sandbox'] as const,
  credentialGroups: GROUPS,
};

describe('list supported banks', () => {
  it('hands the form the credential groups the bank declared, in order', async () => {
    const listSupportedBanks = makeListSupportedBanks({ banks: { list: () => [BANESCO] } });

    // Two groups: the required Confirmación pair and the optional Consulta pair.
    // No code here mentions either — it projects whatever the gateway declares.
    expect(listSupportedBanks()).toEqual([
      {
        id: 'banesco',
        displayName: 'Banesco',
        environments: ['production', 'sandbox'],
        credentialGroups: GROUPS,
      },
    ]);
  });

  it('returns data, not gateways', async () => {
    const gateway = { ...BANESCO, authenticate: () => Promise.reject(new Error('unreachable')) };
    const listSupportedBanks = makeListSupportedBanks({ banks: { list: () => [gateway] } });

    const [listed] = listSupportedBanks();

    // A component rendering the picker cannot authenticate as a bank.
    expect(listed && 'authenticate' in listed).toBe(false);
  });
});
