/**
 * The banking use cases, built once from one set of dependencies.
 *
 * Wiring only — no logic lives here and nothing is constructed. `src/container.ts`
 * builds the adapters from `env` and hands them in; this file is the seam where
 * the concrete collaborators meet the narrow ports each use case declared for
 * itself, and the compiler checks the fit at exactly this line rather than
 * inside a handler.
 *
 * It is therefore the only file in the layer that names the repository
 * interface as a whole, and it names it as a *type*. No adapter is imported,
 * nothing is instantiated, and a test builds the same bundle out of fakes.
 */
import type { BankAccountRepository } from '../../adapters/d1/bank-account.repository.ts';
import type { Clock } from '../../shared/clock.ts';
import type { IdGen } from '../../shared/id.ts';
import type { BankGateway, BankId } from '../ports/bank-gateway.ts';
import {
  type ChangeBankCredentials,
  makeChangeBankCredentials,
} from './change-bank-credentials.ts';
import { type ConnectBankAccount, makeConnectBankAccount } from './connect-bank-account.ts';
import { type ListBankAccounts, makeListBankAccounts } from './list-bank-accounts.ts';
import { type ListSupportedBanks, makeListSupportedBanks } from './list-supported-banks.ts';
import type { VerificationStore } from './pending-verification.ts';
import { makeRemoveBankAccount, type RemoveBankAccount } from './remove-bank-account.ts';
import { makeReverifyBankAccount, type ReverifyBankAccount } from './reverify-bank-account.ts';
import {
  makeVerifyBankCredentials,
  type VerifyBankCredentials,
} from './verify-bank-credentials.ts';

export type BankingDeps = {
  /** `BankRegistry`: the strategy selector, built per request. */
  readonly banks: {
    get(bank: BankId): BankGateway;
    list(): readonly BankGateway[];
  };
  readonly accounts: BankAccountRepository;
  readonly verifications: VerificationStore;
  /** The AES-GCM master key. Read from `env` once, in the container. */
  readonly credsKey: string;
  readonly clock: Clock;
  readonly ids: IdGen;
};

export type BankingUseCases = {
  readonly listSupportedBanks: ListSupportedBanks;
  readonly verifyBankCredentials: VerifyBankCredentials;
  readonly connectBankAccount: ConnectBankAccount;
  readonly listBankAccounts: ListBankAccounts;
  readonly removeBankAccount: RemoveBankAccount;
  readonly reverifyBankAccount: ReverifyBankAccount;
  readonly changeBankCredentials: ChangeBankCredentials;
};

export function makeBankingUseCases(deps: BankingDeps): BankingUseCases {
  return {
    listSupportedBanks: makeListSupportedBanks(deps),
    verifyBankCredentials: makeVerifyBankCredentials(deps),
    connectBankAccount: makeConnectBankAccount(deps),
    listBankAccounts: makeListBankAccounts(deps),
    removeBankAccount: makeRemoveBankAccount(deps),
    reverifyBankAccount: makeReverifyBankAccount(deps),
    changeBankCredentials: makeChangeBankCredentials(deps),
  };
}
