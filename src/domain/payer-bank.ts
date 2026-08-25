/**
 * The bank the *payer* used, as the counter offers it — Sudeban's twenty-six
 * plus whatever custom brands the platform has configured.
 *
 * A custom payer bank is a brand a customer pays from that Sudeban's table does
 * not list. Ubii is the first: a customer's receipt says Ubii, so the picker has
 * to say Ubii and every listing has to print it back — but the *bank we ask* is
 * a real one, because Ubii's pago móvil lands in Venezolano de Crédito against a
 * phone of ours. Two facts, and neither is allowed to overwrite the other:
 *
 *   * what was **recorded** — the code the cashier picked and the phone the
 *     customer read out, which is what a merchant, a receipt and a support call
 *     are all about;
 *   * what was **asked** — `askedPayer` below, the Sudeban code and the phone
 *     that actually travel to the bank, kept on the row as `realTarget` so a
 *     movement can still be found at the bank that holds it.
 *
 * The two catalogues never collide because a Sudeban code is exactly four
 * digits and a custom code never is: `findPayerBank` resolves four digits from
 * `sudeban.ts` and everything else from the configured rows, with no precedence
 * rule to get wrong. That is also the whole validation on a code being created.
 *
 * Pure, like everything else here: the configured rows arrive as an argument.
 * Nothing in this file reads a database, a clock or an environment.
 */
import { findBank, SUDEBAN_BANKS } from './sudeban.ts';

/**
 * One configured brand, as the platform admin fills it in.
 *
 * `targetPhone` is nullable and the null means something specific: send the
 * phone the cashier typed. A brand that only needs its Sudeban code rewritten
 * has no fixed number to substitute, and inventing one would be worse than
 * leaving the field empty.
 */
export type CustomPayerBank = {
  /** A slug, never four digits — see the note above. `'ubii'`. */
  readonly code: string;
  /** What the picker shows and every listing prints. `'Ubii'`. */
  readonly name: string;
  /** The Sudeban code the bank is actually asked with. `'0104'`. */
  readonly targetBankId: string;
  /** E.164, or null for "ask with whatever was typed". `'+584142698301'`. */
  readonly targetPhone: string | null;
  readonly status: CustomPayerBankStatus;
};

/**
 * A disabled brand disappears from the picker and keeps naming the payments it
 * already took: `validations.source_bank_id` outlives the row that explains it,
 * the same way a disabled cashier keeps naming their validations (§6).
 */
export type CustomPayerBankStatus = 'active' | 'disabled';

/**
 * A payer bank as any screen needs it: something to pick and something to name.
 *
 * `suggestedPhone` is the counter's prefill and nothing more — the field stays
 * editable, and what the cashier leaves in it is what gets recorded. What
 * travels to the bank is `askedPayer`'s business, decided on the server.
 */
export type PayerBank = {
  readonly code: string;
  readonly name: string;
  /**
   * The Sudeban code this bank is *asked under* — its own for the twenty-six,
   * and the real bank behind it for a custom brand.
   *
   * It is what a picker prints beside the name, because four digits are what
   * people who work with these every day recognise and a slug is not. Showing it
   * gives nothing away and decides nothing: the routing is `askedPayer`'s, on
   * the server, re-read from the configured row on every charge — this is the
   * same fact rendered, not a value anything trusts on the way back.
   */
  readonly sudebanCode: string;
  readonly suggestedPhone: string | null;
};

/**
 * What the bank is actually asked with, once the payer's pick has been
 * resolved. Equal to the pick for all twenty-six Sudeban banks; rewritten for a
 * custom one.
 */
export type AskedPayer = {
  readonly sourceBankId: string;
  /** Null for a kind that carries no phone at all — a transferencia. */
  readonly payerPhone: string | null;
};

/**
 * A slug: lowercase, starts with a letter, 2–24 characters. The leading letter
 * is what guarantees it can never be read as a four-digit Sudeban code, which
 * is the one property the rest of this file relies on.
 */
const CUSTOM_CODE = /^[a-z][a-z0-9-]{1,23}$/;

export function isCustomPayerBankCode(code: string): boolean {
  return CUSTOM_CODE.test(code);
}

/** A Sudeban code, exactly as `sudeban.ts` spells one. */
export function isSudebanCode(code: string): boolean {
  return findBank(code) !== null;
}

/** The configured row, shaped for a picker or a listing. */
export function toPayerBank(bank: CustomPayerBank): PayerBank {
  return {
    code: bank.code,
    name: bank.name,
    sudebanCode: bank.targetBankId,
    suggestedPhone: bank.targetPhone,
  };
}

/**
 * Everything a cashier may pick: Sudeban's list in Sudeban's order, then the
 * custom brands.
 *
 * Custom last rather than first, because the twenty-six are the overwhelming
 * case and a picker that opens on a brand nobody uses is a picker that gets
 * scrolled past all day.
 */
export function payerBankCatalogue(custom: readonly PayerBank[]): readonly PayerBank[] {
  const sudeban = SUDEBAN_BANKS.map(
    (bank): PayerBank => ({
      code: bank.code,
      name: bank.name,
      sudebanCode: bank.code,
      suggestedPhone: null,
    }),
  );
  return [...sudeban, ...custom];
}

/**
 * A code as a name-bearing bank, or null when neither catalogue knows it.
 *
 * Null is not a fault at a listing: the row records what the bank was asked
 * with, and that stays true after a brand is renamed or Sudeban adds a code we
 * have not heard of. Every caller falls back to printing the code itself.
 */
export function findPayerBank(code: string, custom: readonly PayerBank[]): PayerBank | null {
  const sudeban = findBank(code);
  if (sudeban !== null) {
    return {
      code: sudeban.code,
      name: sudeban.name,
      sudebanCode: sudeban.code,
      suggestedPhone: null,
    };
  }
  return custom.find((bank) => bank.code === code) ?? null;
}

/** The name to print, falling back to the code. The listings' one-liner. */
export function payerBankName(code: string, custom: readonly PayerBank[]): string {
  return findPayerBank(code, custom)?.name ?? code;
}

/**
 * What the bank is asked with — the one rule that decides where a custom brand's
 * question is sent, written once and read by the use case that sends it.
 *
 * `custom` is null for the ordinary case (the payer picked a Sudeban bank), and
 * then the pick *is* the question. For a custom brand the Sudeban code is
 * always rewritten; the phone is rewritten only when the brand carries one and
 * only for a kind that sends a phone at all — a transferencia carries none, and
 * substituting into a field that is not on the wire would be a fact invented
 * for nobody.
 */
export function askedPayer(input: {
  readonly sourceBankId: string;
  readonly payerPhone: string | null;
  readonly custom: CustomPayerBank | null;
}): AskedPayer {
  if (input.custom === null) {
    return { sourceBankId: input.sourceBankId, payerPhone: input.payerPhone };
  }
  return {
    sourceBankId: input.custom.targetBankId,
    payerPhone: input.payerPhone === null ? null : (input.custom.targetPhone ?? input.payerPhone),
  };
}

/**
 * Whether what was asked differs from what was recorded. The row carries its
 * `realTarget` only when it does, so a metadata column full of `{"realTarget":
 * {"sourceBankId":"0134"}}` on every ordinary pago móvil never happens.
 */
export function payerWasRewritten(recorded: AskedPayer, asked: AskedPayer): boolean {
  return recorded.sourceBankId !== asked.sourceBankId || recorded.payerPhone !== asked.payerPhone;
}
