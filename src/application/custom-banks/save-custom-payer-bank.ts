/**
 * Creating and editing a custom payer brand — one use case, because the two
 * flows ask for exactly the same four things (§11). Which of the two it is is
 * the presence of an existing row under the code, not a second entry point.
 *
 * Everything it refuses, it refuses for a reason that reaches the counter:
 *
 *  - a **code** that is not a slug could be read as a Sudeban code, and the
 *    whole reason the two catalogues never collide is that one is four digits
 *    and the other cannot be. It is also immutable once written — it is the
 *    primary key and `validations.source_bank_id` already names it.
 *  - a **target bank** that is not in Sudeban's table is a question no bank will
 *    answer: the code is what the search matches on, and a wrong one comes back
 *    `sin resultados` in front of a customer.
 *  - a **phone** is stored E.164 like every other phone here (§6), normalised by
 *    the domain rather than by whatever the admin pasted. Empty is not invalid:
 *    it means "ask with the number the cashier typed".
 */

import type {
  CustomPayerBankEdit,
  NewCustomPayerBank,
} from '../../adapters/d1/custom-payer-bank.repository.ts';
import type { CustomPayerBankStatus } from '../../domain/payer-bank.ts';
import { isCustomPayerBankCode, isSudebanCode } from '../../domain/payer-bank.ts';
import { normalisePhone } from '../../domain/phone.ts';
import type { Clock } from '../../shared/clock.ts';
import { err, ok, type Result } from '../../shared/result.ts';

type CustomPayerBankWriter = {
  insert(input: NewCustomPayerBank): Promise<'inserted' | 'code_taken'>;
  update(code: string, input: CustomPayerBankEdit): Promise<'updated' | 'not_found'>;
};

export type SaveCustomPayerBankDeps = {
  readonly customBanks: CustomPayerBankWriter;
  readonly clock: Clock;
};

export type SaveCustomPayerBankInput = {
  readonly code: string;
  readonly name: string;
  readonly targetBankId: string;
  /** As typed. Empty or absent means "send whatever the cashier typed". */
  readonly targetPhone: string | null;
  readonly status: CustomPayerBankStatus;
  /** True for the "nuevo banco" dialog, false when an existing row is edited. */
  readonly creating: boolean;
};

export type SaveCustomPayerBankFailure =
  | 'invalid_code'
  | 'invalid_name'
  | 'invalid_target_bank'
  | 'invalid_phone'
  | 'code_taken'
  | 'not_found';

export type SaveCustomPayerBank = (
  input: SaveCustomPayerBankInput,
) => Promise<Result<null, SaveCustomPayerBankFailure>>;

/** Long enough for a brand, short enough to sit in a dropdown row. */
const MAX_NAME = 40;

export function makeSaveCustomPayerBank({
  customBanks,
  clock,
}: SaveCustomPayerBankDeps): SaveCustomPayerBank {
  return async (input) => {
    const code = input.code.trim().toLowerCase();
    if (!isCustomPayerBankCode(code)) return err('invalid_code');

    const name = input.name.trim();
    if (name === '' || name.length > MAX_NAME) return err('invalid_name');

    const targetBankId = input.targetBankId.trim();
    if (!isSudebanCode(targetBankId)) return err('invalid_target_bank');

    // Empty is a value here, not a missing one: it is what "use the phone that
    // was typed" is spelled as on a form with a text field in it.
    const typedPhone = (input.targetPhone ?? '').trim();
    let targetPhone: string | null = null;
    if (typedPhone !== '') {
      targetPhone = normalisePhone(typedPhone);
      if (targetPhone === null) return err('invalid_phone');
    }

    const row = { name, targetBankId, targetPhone, status: input.status, at: clock.nowSeconds() };

    if (input.creating) {
      const written = await customBanks.insert({ code, ...row });
      return written === 'code_taken' ? err('code_taken') : ok(null);
    }

    const written = await customBanks.update(code, row);
    return written === 'not_found' ? err('not_found') : ok(null);
  };
}
