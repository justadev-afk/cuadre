/**
 * What a credential has to look like before it is hashed.
 *
 * Two shapes, because two populations log in differently: everyone with an
 * email uses a password, and a cashier uses `(company_id, username)` plus a
 * PIN. Both go through the same PBKDF2 in `src/shared/crypto.ts`; the
 * difference in strength is made up elsewhere, and that "elsewhere" is
 * `MAX_PIN_ATTEMPTS_PER_HOUR`.
 */

export const PASSWORD_MIN_LENGTH = 8;

/**
 * Not a strength rule. PBKDF2 at 100k iterations hashes whatever it is given,
 * so an unbounded field is a CPU cost a stranger controls on a Worker with a
 * request budget. No human types 200 characters at a login screen.
 */
export const PASSWORD_MAX_LENGTH = 200;

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 6;

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;

/**
 * Per user, per hour. A four-digit PIN has ten thousand values, which is
 * indefensible against anything that can guess freely — this limit is the only
 * reason it is defensible at all. At five attempts an hour, an attacker needs
 * roughly a century to cover the space, and the cashier gets a credential they
 * can enter one-handed at a counter with a queue behind it.
 *
 * Lower the PIN length or raise this number and that trade collapses. They are
 * a pair.
 */
export const MAX_PIN_ATTEMPTS_PER_HOUR = 5;

export function isValidPassword(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH;
}

// Built from the constants above so the bounds cannot drift out of step with
// them, and built once so nothing compiles a pattern per login attempt.
const CANONICAL_USERNAME = new RegExp(
  `^[a-z0-9._-]{${USERNAME_MIN_LENGTH},${USERNAME_MAX_LENGTH}}$`,
);
const CANONICAL_PIN = new RegExp(`^\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`);

/**
 * Lowercase by construction, not by normalisation: the login tuple is
 * `(company_id, username)` under a UNIQUE index, and 'maria.r' and 'Maria.R'
 * resolving to two rows in the same company is a cashier logging in as
 * somebody else's history.
 */
export function isValidUsername(username: string): boolean {
  return CANONICAL_USERNAME.test(username);
}

/**
 * Length, digits only, and a refusal of the PINs that get chosen when nobody
 * is watching. Blocking the trivial ones matters more here than in most places
 * because the rate limit assumes an attacker is guessing blind — if the PIN is
 * '1234', the first of the five attempts an hour is enough.
 */
export function isValidPin(pin: string): boolean {
  if (!CANONICAL_PIN.test(pin)) return false;
  if (isOneRepeatedDigit(pin)) return false;
  if (isConsecutiveRun(pin)) return false;
  return true;
}

/** '0000', '7777'. */
function isOneRepeatedDigit(pin: string): boolean {
  return /^(\d)\1+$/.test(pin);
}

/**
 * '1234' and '4321', and their longer forms. Strict steps of one only: there
 * is no wrap-around, so '7890' is an ordinary PIN and '9012' is too.
 */
function isConsecutiveRun(pin: string): boolean {
  const step = Number(pin[1]) - Number(pin[0]);
  if (step !== 1 && step !== -1) return false;
  for (let i = 2; i < pin.length; i++) {
    if (Number(pin[i]) - Number(pin[i - 1]) !== step) return false;
  }
  return true;
}
