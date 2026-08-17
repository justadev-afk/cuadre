-- The payer's phone, stored as E.164.
--
-- `validations.payer_phone` held the country code and the ten national digits
-- with no plus — `584143125566` — because that spelling is what Banesco's
-- `phoneNum` field takes, and the one canonical form in the domain had quietly
-- become the bank's wire format rather than a phone number. It showed: the
-- panel's column printed the stored string raw, so a merchant read
-- `584120324942` in a table beside a modal that said `0412-0324942`.
--
-- The canonical form is `+584143125566` now (`src/domain/phone.ts`), the plus
-- included, and every surface renders exactly that. What a bank wants on the
-- wire is that bank's own business again: `wirePhone` in the Banesco client
-- strips the plus on the way out, which is where a bank's spelling belongs (§4).
--
-- This brings the rows already stored across. Not destructive — no column is
-- dropped or retyped, nothing is deleted — and idempotent: the `NOT LIKE '+%'`
-- means running it twice cannot produce '++58…'.
--
-- Reading code tolerates either spelling regardless (`formatPhoneForDisplay`
-- normalises what it is given), so this is a data repair, not a deploy gate.
-- What it does fix is the exact-match branch of the panel's search, which
-- compares a searched number against the stored one.

UPDATE validations
   SET payer_phone = '+' || payer_phone
 WHERE payer_phone IS NOT NULL
   AND payer_phone NOT LIKE '+%';
