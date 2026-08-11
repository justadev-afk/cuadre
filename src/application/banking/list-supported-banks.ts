/**
 * Every bank a company could connect today, as the onboarding form needs it.
 *
 * The form has no per-bank branch and no list of its own: it renders the fields
 * each gateway declares, in the order it declares them. That is the whole
 * reason `credentialFields` is on the port — Banesco grew from two credentials
 * to four when its Keycloak clients turned out to have service accounts
 * disabled, and the screen did not change.
 *
 * The gateways themselves are not returned. A gateway is a live collaborator
 * holding tokens for this request; what the picker needs is four facts about
 * it, and a projection is the difference between a component rendering a bank
 * and a component able to authenticate as one.
 */
import type {
  BankCredentialGroup,
  BankEnvironment,
  BankId,
  BankPaymentKind,
  BankReceivingAccountRule,
} from '../ports/bank-gateway.ts';

/**
 * The port, declared here and structurally: this file depends on the shape it
 * reads, not on the class that answers. `BankRegistry` satisfies it, and so
 * does an object literal in a test.
 */
type BankCatalogue = {
  list(): readonly {
    readonly id: BankId;
    readonly displayName: string;
    readonly environments: readonly BankEnvironment[];
    readonly credentialGroups: readonly BankCredentialGroup[];
    readonly paymentKinds: readonly BankPaymentKind[];
    readonly receivingAccountRule: BankReceivingAccountRule | null;
  }[];
};

export type ListSupportedBanksDeps = {
  readonly banks: BankCatalogue;
};

export type SupportedBank = {
  readonly id: BankId;
  /** Rendered in the picker. Spanish where the bank's own name differs. */
  readonly displayName: string;
  readonly environments: readonly BankEnvironment[];
  readonly credentialGroups: readonly BankCredentialGroup[];
  /**
   * What this bank can be asked about, and what each kind takes. The counter's
   * "Pago móvil / Transferencia" selector and both of its forms are rendered
   * from this, so the fields, their lengths and which of them are required all
   * arrive from the bank rather than being decided on the screen.
   */
  readonly paymentKinds: readonly BankPaymentKind[];
  /**
   * How this bank spells the accounts that receive a transferencia — the field
   * that collects them reads its length, its prefix and its copy from here.
   */
  readonly receivingAccountRule: BankReceivingAccountRule | null;
};

export type ListSupportedBanks = () => readonly SupportedBank[];

export function makeListSupportedBanks({ banks }: ListSupportedBanksDeps): ListSupportedBanks {
  return () =>
    banks.list().map((bank) => ({
      id: bank.id,
      displayName: bank.displayName,
      environments: bank.environments,
      credentialGroups: bank.credentialGroups,
      paymentKinds: bank.paymentKinds,
      receivingAccountRule: bank.receivingAccountRule,
    }));
}
