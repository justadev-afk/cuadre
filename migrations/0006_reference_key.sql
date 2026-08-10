-- `validations.reference` keeps the reference exactly as it was typed, and the
-- anti-double-charge index moves to a canonical key beside it.
--
-- A reference is a number the customer reads off their receipt, and plenty of
-- them begin with zeros — `00000150496`. The bank does not always agree on the
-- padding (Banesco answers that one as `150496` and pads others the other way),
-- so the row used to store *the bank's* spelling. That is the wrong trade: it
-- is the customer's receipt a cashier has to match a charge against, and a
-- control code beside a reference the customer cannot find on their phone is
-- worse than useless.
--
-- The reason the bank's spelling was stored is still true and still enforced,
-- just not by the same column: `ux_validations_payment` was unique over
-- (bank_account_id, reference), so keeping what was typed would let `150496`
-- and `00000150496` both through as separate charges for one payment. The index
-- moves onto `reference_key` — the reference with its leading zeros folded, the
-- very transform `canonicalReference` in `src/domain/payment-match.ts` already
-- uses to decide two spellings are one payment. Two cashiers racing the same
-- payment in different paddings still collide; one INSERT still wins.
--
-- Additive and backfilled, so no charge is lost and nothing is retyped.
--
-- The column is **nullable on purpose**. A migration is applied around a push,
-- and for the couple of minutes the previous build is still serving, its INSERT
-- does not name this column. With `NOT NULL DEFAULT ''` every such row would key
-- on '' and the second one would be refused as "ya cobrado" — a real payment
-- turned away at a counter. NULLs are distinct to a SQLite unique index, so
-- instead those rows simply carry no key, and the previous build's own
-- pre-flight check (which reads `reference`) still covers them. Backfill any
-- stragglers with the UPDATE below once the deploy is live.

ALTER TABLE validations ADD COLUMN reference_key TEXT;

-- The SQL half of `canonicalReference`: strip spaces, upper-case, drop leading
-- zeros — but keep the last digit, so '000' folds to '0' rather than to nothing.
UPDATE validations
   SET reference_key = CASE
         WHEN ltrim(upper(replace(reference, ' ', '')), '0') = '' THEN '0'
         ELSE ltrim(upper(replace(reference, ' ', '')), '0')
       END;

-- One payment can only be charged once — now regardless of how it was spelled.
DROP INDEX ux_validations_payment;
CREATE UNIQUE INDEX ux_validations_payment ON validations (bank_account_id, reference_key);
