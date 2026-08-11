/**
 * Is this a number this bank could receive a transferencia in?
 *
 * One function, three callers: the field a merchant types into (so the refusal
 * is a toast the moment they press Enter), the use case that stores the list,
 * and the editor that changes it later. A rule that decides what reaches a bank
 * is written once (§11) — and it is the *bank's* rule, read off
 * `receivingAccountRule`, never twenty-and-Banesco spelled into a screen.
 */
import type { BankReceivingAccountRule } from '../ports/bank-gateway.ts';

export type ReceivingAccountRefusal = 'wrong_length' | 'wrong_bank' | 'duplicate';

export type ReceivingAccountCheck =
  | { readonly ok: true; readonly account: string }
  | { readonly ok: false; readonly reason: ReceivingAccountRefusal };

/**
 * `already` is what the merchant has typed so far: the same account twice is a
 * refusal rather than a silent no-op, because the second one is always a
 * mistake — either a mis-paste or a number they meant to differ.
 */
export function checkReceivingAccount(
  rule: BankReceivingAccountRule,
  raw: string,
  already: readonly string[] = [],
): ReceivingAccountCheck {
  const account = raw.replace(/\D/g, '');
  if (account.length !== rule.digits) return { ok: false, reason: 'wrong_length' };
  if (rule.prefix !== null && !account.startsWith(rule.prefix)) {
    return { ok: false, reason: 'wrong_bank' };
  }
  if (already.includes(account)) return { ok: false, reason: 'duplicate' };
  return { ok: true, account };
}

/**
 * The whole list, filtered to what this bank could actually be asked with.
 *
 * Silent on purpose, and only on the server: the field already told the
 * merchant, one account at a time, why a number was refused. This is the
 * boundary that makes sure a hand-built form post cannot store a number the
 * search would 400 on.
 */
export function keepValidReceivingAccounts(
  rule: BankReceivingAccountRule | null,
  raw: readonly string[],
): string[] {
  if (rule === null) return [];

  const kept: string[] = [];
  for (const candidate of raw) {
    const checked = checkReceivingAccount(rule, candidate, kept);
    if (checked.ok) kept.push(checked.account);
  }
  return kept;
}
