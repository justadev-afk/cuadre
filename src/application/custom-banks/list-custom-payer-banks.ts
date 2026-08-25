/**
 * The configured payer brands, read back — for the admin's table (all of them)
 * and for everything that has to name or offer one (the active ones).
 *
 * Two entry points rather than a flag, because the two questions are asked by
 * different screens for different reasons: an admin manages the disabled rows
 * and a counter must never be offered one.
 */
import type { CustomPayerBank, PayerBank } from '../../domain/payer-bank.ts';
import { toPayerBank } from '../../domain/payer-bank.ts';

type CustomPayerBankReader = {
  list(): Promise<readonly CustomPayerBank[]>;
  listActive(): Promise<readonly CustomPayerBank[]>;
};

export type ListCustomPayerBanksDeps = { readonly customBanks: CustomPayerBankReader };

/** The admin's table: every brand, whatever its status. */
export type ListCustomPayerBanks = () => Promise<readonly CustomPayerBank[]>;

/**
 * What a picker offers and a listing names — the active brands, stripped to the
 * two fields a screen has any business with plus the counter's prefill. The
 * target bank never reaches a browser: it is how we route, not what the
 * merchant paid into, and a screen that knew it would be a screen that could
 * disagree with the server about where a question went.
 */
export type ListPayerBankOptions = () => Promise<readonly PayerBank[]>;

export function makeListCustomPayerBanks({
  customBanks,
}: ListCustomPayerBanksDeps): ListCustomPayerBanks {
  return () => customBanks.list();
}

export function makeListPayerBankOptions({
  customBanks,
}: ListCustomPayerBanksDeps): ListPayerBankOptions {
  return async () => (await customBanks.listActive()).map(toPayerBank);
}
