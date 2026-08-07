/**
 * What survives between "these credentials work" and "connect this account" —
 * the one place in onboarding where the flow stops and waits for a person.
 *
 * Nothing is written to `bank_accounts` until the merchant picks an account, so
 * credentials that have already authenticated have to wait somewhere for the
 * length of that decision. They wait in KV, **sealed**, under a random id, for
 * ten minutes. Two consequences are deliberate:
 *
 *  - The store below moves an opaque envelope and never sees a client secret,
 *    exactly as `D1BankAccountRepository` never does. The key that opens it
 *    belongs to the use case, which is the only layer with a reason to hold it.
 *  - The account numbers the bank listed are inside that envelope too. A full
 *    account number is what the bank wants back in a request, so it never
 *    crosses the wire: the picker renders the bank's own masking and sends back
 *    a *handle*, and the handle only means something to the envelope it came
 *    from.
 *
 * This file is a port and its vocabulary, not a use case — it is here rather
 * than in `ports/` because the two steps of one flow are its only consumers and
 * splitting a shared type away from them would only hide the pairing.
 */
import type { Sealed } from '../../shared/crypto.ts';
import type { BankAccountSummary, BankEnvironment, BankId } from '../ports/bank-gateway.ts';
import type { AccountCredentials } from './account-credentials.ts';

/**
 * Long enough to read a list of accounts and choose one — including the pause
 * where the merchant goes to ask which account the shop actually banks with —
 * and short enough that an abandoned onboarding leaves nothing behind for
 * longer than a coffee break.
 */
export const VERIFICATION_TTL_SECONDS = 600;

/** The plaintext inside the envelope. It exists only between two requests. */
export type VerificationPayload = {
  /** Checked against the caller on step two: a handle is not an authorisation. */
  readonly companyId: string;
  readonly bank: BankId;
  readonly environment: BankEnvironment;
  /** Every credential pair the merchant gave and we verified, keyed by service. */
  readonly credentials: AccountCredentials;
  /**
   * Which key the counter will run on — the operate group's. Carried so the
   * connect step can surface the right client id's tail without re-reading the
   * gateway's declaration.
   */
  readonly operateKey: string;
  /**
   * As the bank listed them, full account numbers and all. Empty when no
   * discover pair was given: the merchant then types the receiving number in.
   */
  readonly accounts: readonly BankAccountSummary[];
};

/**
 * An `interface` because a KV adapter declares `implements` against it: the
 * compiler then reports a drifted signature on the adapter rather than on the
 * use case that tried to call it.
 *
 * The adapter's whole job is encoding — `Sealed` carries `Uint8Array`s, which
 * `JSON.stringify` turns into an object of numbered keys, so ciphertext and IV
 * are base64 on the way in and back to bytes on the way out.
 */
export interface VerificationStore {
  put(verifyId: string, sealed: Sealed, ttlSeconds: number): Promise<void>;
  get(verifyId: string): Promise<Sealed | null>;
  /** Called the moment the verification is spent. A handle is single-use. */
  delete(verifyId: string): Promise<void>;
}

/**
 * The handle the picker sends back. It is a position in the sealed list and
 * nothing else — prefixed so that it can never be mistaken for, or quietly
 * substituted with, a bank's account number.
 */
const HANDLE_PREFIX = 'acct-';

export function accountHandle(index: number): string {
  return `${HANDLE_PREFIX}${index}`;
}

/**
 * The account a handle names, or `null`. Resolved by scanning the list rather
 * than by parsing an integer out of the handle, so a crafted handle can only
 * ever select one of the accounts this bank actually listed.
 */
export function accountByHandle(
  accounts: readonly BankAccountSummary[],
  handle: string,
): BankAccountSummary | null {
  const index = accounts.findIndex((_, at) => accountHandle(at) === handle);
  return index === -1 ? null : accounts[index];
}
