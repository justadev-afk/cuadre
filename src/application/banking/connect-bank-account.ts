/**
 * The last step of connecting a bank, and the only one that writes anything.
 *
 * The merchant has already proven the credentials at `verify-bank-credentials`:
 * the operate pair authenticated, and — if they gave it — the discover pair
 * listed these accounts. So this step asks the bank *nothing*. It resolves which
 * account the merchant picked (a handle into the sealed list, or a number they
 * typed when they gave no discover pair), seals both credential pairs and the
 * full account number, and writes the row.
 *
 * No smoke read here, on purpose. It used to list today's movements to prove the
 * account was readable, but that call runs on the operate service, and firing it
 * at the moment of *saving* both made the two-client split fail the save and
 * turned a visual choice into a bank round-trip. The proof the merchant needs —
 * "these credentials are real" — was already given a step ago; reading the
 * account is what the first validation at the counter does, loudly, where it
 * belongs.
 */
import type {
  BankAccount,
  BankAccountWriteFailure,
  NewBankAccount,
  NewStoredCredential,
} from '../../adapters/d1/bank-account.repository.ts';
import type { Clock } from '../../shared/clock.ts';
import { type Sealed, seal, unseal } from '../../shared/crypto.ts';
import { AppError, forbidden } from '../../shared/errors.ts';
import type { IdGen } from '../../shared/id.ts';
import { logger } from '../../shared/logger.ts';
import { err, ok, type Result } from '../../shared/result.ts';
import { type BankAccountView, toBankAccountView } from './bank-account-view.ts';
import {
  accountByHandle,
  type VerificationPayload,
  type VerificationStore,
} from './pending-verification.ts';

/** The two writes this file makes, and nothing else. */
type BankAccountWriter = {
  insert(input: NewBankAccount): Promise<Result<BankAccount, BankAccountWriteFailure>>;
  markVerified(
    id: string,
    at: number,
    credsExpireAt: number | null,
  ): Promise<Result<BankAccount, BankAccountWriteFailure>>;
};

export type ConnectBankAccountDeps = {
  readonly accounts: BankAccountWriter;
  readonly verifications: VerificationStore;
  readonly credsKey: string;
  readonly clock: Clock;
  readonly ids: IdGen;
};

export type ConnectBankAccountInput = {
  readonly companyId: string;
  readonly verifyId: string;
  /** The handle from `verify`, when the discover pair listed accounts to pick. */
  readonly accountId?: string;
  /** The full receiving account number, when the merchant gave no discover pair. */
  readonly accountNumber?: string;
};

export type ConnectBankAccountFailure =
  /** The ten minutes ran out, or the handle was already spent. Start again. */
  | 'verification_expired'
  | 'unknown_account'
  /** The typed account number is not a plausible account. */
  | 'invalid_account'
  | 'account_already_linked';

export type ConnectBankAccount = (
  input: ConnectBankAccountInput,
) => Promise<Result<BankAccountView, ConnectBankAccountFailure>>;

export function makeConnectBankAccount({
  accounts,
  verifications,
  credsKey,
  clock,
  ids,
}: ConnectBankAccountDeps): ConnectBankAccount {
  return async (input) => {
    const sealed = await verifications.get(input.verifyId);
    if (sealed === null) return err('verification_expired');

    const pending = await openVerification(credsKey, sealed);
    if (pending === null) return err('verification_expired');

    // A handle is not an authorisation. It is a uuid nobody else can guess, but
    // "nobody can guess it" is not the boundary between merchants — this is.
    if (pending.companyId !== input.companyId) {
      throw forbidden(`verification ${input.verifyId} belongs to another company`);
    }

    const chosen = resolveAccount(pending, input);
    if (!chosen.ok) return chosen;

    // One row per pair the merchant gave, keyed by service. The operate key
    // (Banesco's Confirmación) is marked `operate`; anything else the wizard
    // collected only ever listed accounts, so it is `discover`. Each pair is
    // sealed on its own; what survives in the clear is the six-digit tail of
    // each client id, which is all the panel shows.
    const accountId = ids.uuid();
    const credentials = await sealCredentials(credsKey, pending, ids);
    const operateClientId = pending.credentials[pending.operateKey]?.clientId ?? '';

    const now = clock.nowSeconds();
    const written = await accounts.insert({
      id: accountId,
      companyId: input.companyId,
      bank: pending.bank,
      environment: pending.environment,
      clientIdLast6: lastSix(operateClientId),
      accountNumber: await seal(credsKey, chosen.value.fullNumber),
      accountLast4: chosen.value.accountLast4,
      accountType: chosen.value.accountType,
      holderId: chosen.value.holderId,
      credentials,
      // The bank tells us its credentials expire by rejecting them. No bank has
      // yet returned an expiry we could read, so nothing is invented here.
      credsExpireAt: null,
      createdAt: now,
    });

    if (!written.ok) {
      // The verification is *not* dropped here on purpose. This account is
      // already connected, but the list the merchant is looking at may hold
      // another one they meant to pick, and spending the handle would make them
      // retype a client secret to correct a misclick.
      if (written.error === 'account_already_linked') return err('account_already_linked');
      throw new AppError('internal', `bank account insert failed: ${written.error}`);
    }

    // The row is minted unverified — `verified_at` is a transition, not a column
    // the INSERT owns — and the credentials just authenticated a step ago, so
    // the transition happens now rather than waiting for a first payment.
    const verified = await accounts.markVerified(written.value.id, now, null);
    if (!verified.ok) throw new AppError('internal', `mark verified failed: ${verified.error}`);

    await verifications.delete(input.verifyId);

    logger.info('bank_account_connected', {
      companyId: input.companyId,
      bank: pending.bank,
      environment: pending.environment,
      accountLast4: verified.value.accountLast4,
      pairs: Object.keys(pending.credentials).length,
    });

    return ok(toBankAccountView(verified.value));
  };
}

type ResolvedAccount = {
  readonly fullNumber: string;
  readonly accountLast4: string;
  readonly accountType: string | null;
  readonly holderId: string | null;
};

/**
 * Which account the merchant chose, from whichever path onboarding took.
 *
 * With a discover pair the list is real and the choice is a handle into it —
 * resolved by scanning, so a crafted handle can only ever name one of the
 * accounts the bank actually listed. Without one there is no list: the merchant
 * typed the receiving number, and all we can judge is that it is a plausible
 * account rather than a slip of the keyboard.
 */
function resolveAccount(
  pending: VerificationPayload,
  input: ConnectBankAccountInput,
): Result<ResolvedAccount, 'unknown_account' | 'invalid_account'> {
  // A typed number wins over the picker. The account the merchant banks on may
  // not be in the discover list at all — the list is masked, or the discover
  // pair belongs to a different affiliation than the operate pair — so the
  // wizard always lets them type it, and when they do, that is the choice. A
  // Venezuelan account is twenty digits; the bound is loose on purpose, enough
  // to reject an empty field or a phone number without refusing a real number
  // from a bank we have not met yet.
  const typed = (input.accountNumber ?? '').replace(/\D/g, '');
  if (typed !== '') {
    if (typed.length < 10 || typed.length > 24) return err('invalid_account');
    return ok({
      fullNumber: typed,
      accountLast4: typed.slice(-4),
      accountType: null,
      holderId: null,
    });
  }

  if (pending.accounts.length > 0) {
    const chosen = accountByHandle(pending.accounts, input.accountId ?? '');
    if (chosen === null) return err('unknown_account');
    return ok({
      fullNumber: chosen.accountId,
      accountLast4: lastFourDigits(chosen.accountId, chosen.masked),
      accountType: chosen.type,
      holderId: chosen.holderId,
    });
  }

  return err('invalid_account');
}

/**
 * `null` rather than a throw when the envelope will not open.
 *
 * AES-GCM refuses either because the bytes were tampered with or because
 * `CREDS_KEY` rotated inside the ten-minute window. Both leave the merchant in
 * the same place — the credentials in that envelope are unusable — and the
 * remedy is identical to the one for an expired handle: paste them again.
 */
async function openVerification(
  credsKey: string,
  sealed: Sealed,
): Promise<VerificationPayload | null> {
  try {
    return await unseal<VerificationPayload>(credsKey, sealed);
  } catch {
    logger.warn('verification_unreadable', { keyVersion: sealed.keyVersion });
    return null;
  }
}

/** The four digits `bank_accounts.account_last4` keeps in the clear. */
function lastFourDigits(fullNumber: string, masked: string): string {
  const digits = fullNumber.replace(/\D/g, '');
  // Fall back to the bank's masked form: the column is NOT NULL and part of the
  // per-company unique key, so an empty value would collapse two accounts into
  // one row's worth of uniqueness.
  return digits.length >= 4 ? digits.slice(-4) : masked.slice(-4);
}

/**
 * One `NewStoredCredential` per pair the wizard collected. The operate key is
 * marked `operate`, every other pair `discover` — the only two roles a bank
 * declares — and each pair is sealed onto its own row.
 */
function sealCredentials(
  credsKey: string,
  pending: VerificationPayload,
  ids: IdGen,
): Promise<NewStoredCredential[]> {
  return Promise.all(
    Object.entries(pending.credentials).map(async ([credKey, pair]) => ({
      id: ids.uuid(),
      credKey,
      usage: credKey === pending.operateKey ? 'operate' : 'discover',
      clientIdLast6: lastSix(pair.clientId),
      credentials: await seal(credsKey, pair),
    })),
  );
}

function lastSix(clientId: string): string | null {
  return clientId.length === 0 ? null : clientId.slice(-6);
}
