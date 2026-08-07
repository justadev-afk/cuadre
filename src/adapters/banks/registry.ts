/**
 * The strategy selector: bank id → gateway.
 *
 * Every call site reaches a bank the same way — read the `bank` column off the
 * account, ask the registry for that gateway, use the port. No use case ever
 * imports a concrete adapter, so no use case has a branch per bank, and adding
 * one is this file plus a folder.
 *
 * Built once per request from `env`. It holds no mutable state beyond the
 * lookup table it builds in its constructor, which matters: module scope is
 * shared across requests in a Worker isolate, and a bank session must never
 * outlive the request that unsealed the credentials behind it.
 */
import type { BankGateway, BankGatewayDeps, BankId } from '../../application/ports/bank-gateway.ts';
import { AppError } from '../../shared/errors.ts';
import { BanescoGateway } from './banesco/gateway.ts';

export class BankRegistry {
  private readonly gateways: readonly BankGateway[];
  private readonly byId: ReadonlyMap<BankId, BankGateway>;

  constructor(deps: BankGatewayDeps) {
    // The one place a concrete adapter is named. Adding a bank is a line here
    // and a folder beside `banesco/` — never a migration (`bank_accounts.bank`
    // is plain TEXT with no CHECK) and never a branch in a use case.
    this.gateways = [new BanescoGateway(deps)];
    this.byId = new Map(this.gateways.map((gateway) => [gateway.id, gateway]));
  }

  /** Throws `bank_unsupported` for an id with no adapter. */
  get(bank: BankId): BankGateway {
    const gateway = this.byId.get(bank);
    if (!gateway) {
      // A row pointing at an adapter that no longer exists is a deploy mistake,
      // not user input — but it still reaches a user, so it gets the same
      // honest copy as a bank we have simply not built yet.
      throw new AppError('bank_unsupported', `no gateway registered for "${bank}"`);
    }
    return gateway;
  }

  /** Every bank a company could connect today. Feeds the bank picker. */
  list(): readonly BankGateway[] {
    return this.gateways;
  }
}
