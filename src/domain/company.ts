/**
 * Company identity: the slug that is also the primary key, and the RIF.
 *
 * Both follow the same two-function shape used across `src/domain`:
 * `normalise*` turns whatever a human or a bank typed into the one canonical
 * form, and `isValid*` judges that canonical form — the exact bytes we are
 * about to store. `isValid*` is therefore deliberately strict about shape;
 * run `normalise*` first. Pairing them the other way (a lenient validator)
 * is how a non-canonical value reaches a column that other rows point at.
 */

export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 32;

/** Lowercase ASCII kebab: groups of [a-z0-9] joined by single hyphens. */
const CANONICAL_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The slug is `companies.id` — the primary key — and simultaneously the string
 * a cashier types on the login screen. Collapsing those two means there is no
 * second identifier to keep in step.
 *
 * It is **immutable once created**. It sits in `users.company_id`,
 * `bank_accounts.company_id` and `validations.company_id`; changing it would
 * rewrite the ownership of every validation ever recorded. A company renames
 * itself through `companies.name`, never through this.
 */
export function normaliseSlug(raw: string): string | null {
  const slug = foldAccents(raw)
    .toLowerCase()
    // Anything that is not a slug character becomes a separator, so
    // 'Panadería La Espiga, C.A.' and 'panaderia_la_espiga' land on the same
    // string rather than on two companies.
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return isValidSlug(slug) ? slug : null;
}

export function isValidSlug(slug: string): boolean {
  if (slug.length < SLUG_MIN_LENGTH || slug.length > SLUG_MAX_LENGTH) return false;
  return CANONICAL_SLUG.test(slug);
}

/**
 * Canonical RIF: letter, hyphen, 8- or 9-digit body, hyphen, check digit.
 * SENIAT prints a natural person's shorter national id zero-padded to 8, so a
 * 7-digit body is not a separate case — it arrives already padded.
 */
const CANONICAL_RIF = /^([JGVEP])-(\d{8,9})-(\d)$/;

const LOOSE_RIF = /^([JGVEP])(\d{8,9})(\d)$/;

/**
 * SENIAT's letter values. These are **not** alphabetical and not the order the
 * letters are usually listed in; they are verifiable against RIFs in public
 * use, and all three of these agree with the table below and with no other:
 *
 *   Banesco    J-07013380-5
 *   Mercantil  J-00002961-0
 *   Provincial J-00002967-9
 *
 * A validator that rejects our own acquiring banks' RIFs is worse than no
 * validator, so this table is pinned by those three rows in the test file.
 */
const RIF_LETTER_VALUES: Record<string, number> = { V: 1, E: 2, J: 3, P: 4, G: 5 };

/**
 * The reserved test RIF, for the companies we create to exercise the counter.
 * SENIAT issues nothing that is all zeros, so the value belongs to nobody and
 * spending it costs no real taxpayer their identity.
 *
 * It needs no exception in `isValidRif`: mod-11 over a J and a zero body really
 * does come out at 0, so this is an arithmetically correct RIF and the check
 * digit stays the one thing standing between a typo and a permanent squat.
 */
export const TEST_RIF = 'J-00000000-0';

/**
 * Whatever run of zeros a human typed. Someone reaching for "all zeros" types
 * them until it looks right and stops — seven, eight, ten — and every one of
 * those should land on the test company rather than on *RIF inválido*. Eight is
 * the floor so a half-typed `J-0` is still just a half-typed RIF.
 *
 * The class letter goes with the zeros: there is one test RIF and it is a J.
 */
const ALL_ZEROS_RIF = /^[JGVEP]0{8,}$/;

export function normaliseRif(raw: string): string | null {
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (ALL_ZEROS_RIF.test(compact)) return TEST_RIF;

  const parsed = LOOSE_RIF.exec(compact);
  if (parsed === null) return null;
  return `${parsed[1]}-${parsed[2]}-${parsed[3]}`;
}

/**
 * Shape *and* check digit. The check digit is the only thing standing between
 * a typo and a company registered under someone else's tax id, and the RIF
 * carries a UNIQUE constraint, so a wrong one is a permanent squat.
 */
export function isValidRif(rif: string): boolean {
  const parsed = CANONICAL_RIF.exec(rif);
  if (parsed === null) return false;

  const letter = parsed[1];
  const body = parsed[2];
  const check = Number(parsed[3]);
  return rifCheckDigit(letter, body) === check;
}

/**
 * Mod-11 over the letter's value and the body digits.
 *
 * Weights run 2,3,4,5,6,7 right-to-left starting at the digit just left of the
 * check digit, and repeat; the letter takes whichever weight comes next. For
 * the usual 8-digit body that is the published table — letter 4, then
 * 3,2,7,6,5,4,3,2 — and expressing it as the cycle rather than as a literal
 * array is what makes the 9-digit body fall out correctly instead of needing a
 * second hand-written table.
 */
function rifCheckDigit(letter: string, body: string): number {
  let sum = (RIF_LETTER_VALUES[letter] ?? 0) * weightAt(body.length);
  for (let i = 0; i < body.length; i++) {
    sum += Number(body[i]) * weightAt(body.length - 1 - i);
  }
  const check = 11 - (sum % 11);
  // 10 and 11 are not digits; SENIAT collapses both to 0.
  return check >= 10 ? 0 : check;
}

function weightAt(positionFromRight: number): number {
  return (positionFromRight % 6) + 2;
}

/**
 * 'Panadería' -> 'Panaderia'. NFD splits a letter from its accent, then the
 * combining-mark block is dropped; the base letters are untouched, so 'ñ'
 * survives as 'n' rather than disappearing into a separator.
 */
function foldAccents(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
