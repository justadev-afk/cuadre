/**
 * What a payment can be looked up by — shared by the company panel's list and a
 * cashier's own list, so the two never disagree about what a search term means.
 *
 * The digit fields are read aloud rather than copied — a customer says "cero
 * cuatro catorce…" and a cashier types a reference off a receipt printed with
 * spaces — so the phone is matched through the domain's normalisation
 * ('0414-3125566' and '+58 414 3125566' are the same payer) and reference,
 * control code and amount are compared as bare digits. The cajero name is the
 * one text branch, a case-insensitive substring, and the only one that fires
 * for a term like "maría"; a digit-less term that matches no name matches
 * nothing else.
 */
import type { Validation } from '../../adapters/d1/validation.repository.ts';
import { normalisePhone } from '../../domain/phone.ts';

export function matchesValidation(validation: Validation, term: string): boolean {
  const name = foldText(term);
  if (name !== '' && foldText(validation.cashierName ?? '').includes(name)) return true;

  const phone = normalisePhone(term);
  if (phone !== null && validation.payerPhone === phone) return true;

  const digits = term.replace(/\D/g, '');
  if (digits === '') return false;

  return (
    validation.reference.replace(/\D/g, '').includes(digits) ||
    validation.payerPhone.includes(digits) ||
    // The control code the receipt carries — "582422" finds that charge.
    validation.controlCode.replace(/\D/g, '').includes(digits) ||
    // The whole-bolívar figure the list shows — "630" finds Bs 630,00.
    String(Math.trunc(validation.amountCents / 100)).includes(digits)
  );
}

/** Case- and accent-insensitive, so a search for "maria" finds "María". */
function foldText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}
