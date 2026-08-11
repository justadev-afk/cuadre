import { describe, expect, it } from 'vitest';

import type { BankCredentialGroup } from '../../../application/ports/bank-gateway.ts';
import {
  credentialFieldName,
  credentialGroupKeysIn,
  readCredentialPair,
  requiredCredentialsFilled,
} from './credentials.ts';

const GROUPS: readonly BankCredentialGroup[] = [
  {
    key: 'confirmation',
    label: 'Confirmación de Transacciones',
    required: true,
    fields: [
      { name: 'clientId', label: 'Client ID', secret: false },
      { name: 'clientSecret', label: 'Client Secret', secret: true },
    ],
  },
  {
    key: 'consulta',
    label: 'Consulta de Cuentas',
    required: false,
    fields: [
      { name: 'clientId', label: 'Client ID', secret: false },
      { name: 'clientSecret', label: 'Client Secret', secret: true },
    ],
  },
];

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(entries)) data.append(name, value);
  return data;
}

describe('the credentials form wire', () => {
  it('names a field by its group and its field', () => {
    expect(credentialFieldName('confirmation', 'clientSecret')).toBe('confirmation.clientSecret');
  });

  it('reads back exactly what the form named', () => {
    const pair = readCredentialPair(
      form({
        'confirmation.clientId': '17a43e72',
        'confirmation.clientSecret': 's3cr3t',
        'consulta.clientId': '0fedfa00',
      }),
      'confirmation',
    );

    expect(pair).toEqual({ clientId: '17a43e72', clientSecret: 's3cr3t' });
  });

  it('trims the client id but never the secret', () => {
    // A phone keyboard's trailing space on an id is the phone's doing. The same
    // space inside a secret is a character the bank stored, and eating it here
    // is how a credential that works in the portal is refused at the counter.
    const pair = readCredentialPair(
      form({ 'confirmation.clientId': '  17a43e72 ', 'confirmation.clientSecret': ' s3cr3t ' }),
      'confirmation',
    );

    expect(pair).toEqual({ clientId: '17a43e72', clientSecret: ' s3cr3t ' });
  });

  it('answers empty strings for a group the form does not carry', () => {
    expect(readCredentialPair(form({}), 'consulta')).toEqual({ clientId: '', clientSecret: '' });
  });

  it('finds every credential group a form carries, and nothing else', () => {
    const keys = credentialGroupKeysIn(
      form({
        accountId: 'account-1',
        companyId: 'la-espiga',
        'confirmation.clientId': 'a',
        'confirmation.clientSecret': 'b',
        'consulta.clientId': 'c',
      }),
    );

    // Deduped, and the flat fields are not groups.
    expect([...keys].sort()).toEqual(['confirmation', 'consulta']);
  });

  it('ignores a dotted name that is not a credential field', () => {
    expect(credentialGroupKeysIn(form({ 'company.name': 'La Espiga' }))).toEqual([]);
  });

  it('gates the submit on the required groups only', () => {
    const filled = {
      'confirmation.clientId': '17a43e72',
      'confirmation.clientSecret': 's3cr3t',
    };

    expect(requiredCredentialsFilled(GROUPS, filled)).toBe(true);
    // The optional group stays optional…
    expect(requiredCredentialsFilled(GROUPS, { ...filled, 'consulta.clientId': '' })).toBe(true);
    // …while whitespace in a required one is not an answer.
    expect(
      requiredCredentialsFilled(GROUPS, { ...filled, 'confirmation.clientSecret': '   ' }),
    ).toBe(false);
    expect(requiredCredentialsFilled(GROUPS, {})).toBe(false);
  });
});
