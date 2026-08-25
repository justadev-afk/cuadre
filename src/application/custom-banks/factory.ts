/**
 * The custom payer bank use cases, built from one repository. Wiring only.
 */
import type { CustomPayerBankRepository } from '../../adapters/d1/custom-payer-bank.repository.ts';
import type { Clock } from '../../shared/clock.ts';
import {
  type ListCustomPayerBanks,
  type ListPayerBankOptions,
  makeListCustomPayerBanks,
  makeListPayerBankOptions,
} from './list-custom-payer-banks.ts';
import { makeSaveCustomPayerBank, type SaveCustomPayerBank } from './save-custom-payer-bank.ts';

export type CustomBanksDeps = {
  readonly customBanks: CustomPayerBankRepository;
  readonly clock: Clock;
};

export type CustomBankUseCases = {
  readonly listCustomPayerBanks: ListCustomPayerBanks;
  /** The active brands, as a picker and a listing need them. */
  readonly listPayerBankOptions: ListPayerBankOptions;
  readonly saveCustomPayerBank: SaveCustomPayerBank;
};

export function makeCustomBankUseCases(deps: CustomBanksDeps): CustomBankUseCases {
  return {
    listCustomPayerBanks: makeListCustomPayerBanks(deps),
    listPayerBankOptions: makeListPayerBankOptions(deps),
    saveCustomPayerBank: makeSaveCustomPayerBank(deps),
  };
}
