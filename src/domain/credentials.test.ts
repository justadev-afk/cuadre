import { describe, expect, it } from 'vitest';

import {
  isValidPassword,
  isValidPin,
  isValidUsername,
  MAX_PIN_ATTEMPTS_PER_HOUR,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from './credentials.ts';

describe('isValidPassword', () => {
  const table: ReadonlyArray<{ password: string; expected: boolean; why: string }> = [
    { password: 'a'.repeat(8), expected: true, why: 'exactly the minimum' },
    { password: 'a'.repeat(7), expected: false, why: 'one under' },
    { password: '', expected: false, why: 'empty' },
    { password: 'correct horse battery staple', expected: true, why: 'a long passphrase' },
    { password: 'ünïcödé-pw', expected: true, why: 'non-ASCII counts as characters' },
    { password: '🔐🔐🔐🔐🔐', expected: true, why: 'surrogate pairs count as UTF-16 units' },
    { password: '        ', expected: true, why: 'eight spaces: length is the only rule' },
    { password: 'a'.repeat(PASSWORD_MAX_LENGTH), expected: true, why: 'exactly the maximum' },
    {
      password: 'a'.repeat(PASSWORD_MAX_LENGTH + 1),
      expected: false,
      why: 'one over: PBKDF2 cost a stranger controls',
    },
    { password: 'a'.repeat(100_000), expected: false, why: 'the reason the maximum exists' },
  ];

  for (const { password, expected, why } of table) {
    it(`${password.length} chars -> ${expected} (${why})`, () => {
      expect(isValidPassword(password)).toBe(expected);
    });
  }

  it('states its own bounds', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(PASSWORD_MAX_LENGTH).toBeGreaterThan(PASSWORD_MIN_LENGTH);
  });
});

describe('isValidPin', () => {
  const table: ReadonlyArray<{ pin: string; expected: boolean; why: string }> = [
    // accepted
    { pin: '3729', expected: true, why: 'four unremarkable digits' },
    { pin: '90210', expected: true, why: 'five digits' },
    { pin: '481625', expected: true, why: 'six digits, the maximum' },
    { pin: '0182', expected: true, why: 'a leading zero is a digit like any other' },
    { pin: '1122', expected: true, why: 'repeats that are not the whole PIN' },
    { pin: '1213', expected: true, why: 'a near-run' },
    { pin: '7890', expected: true, why: 'no wrap-around: 9 to 0 breaks the run' },
    { pin: '9012', expected: true, why: 'nor the other way' },
    { pin: '1357', expected: true, why: 'a step of two is not a run' },
    { pin: '1235', expected: true, why: 'a run that breaks at the last digit' },
    { pin: '2134', expected: true, why: 'a run that starts at the second digit' },

    // shape
    { pin: '123', expected: false, why: 'three digits' },
    { pin: '3729123', expected: false, why: 'seven digits' },
    { pin: '', expected: false, why: 'empty' },
    { pin: 'abcd', expected: false, why: 'letters' },
    { pin: '37a9', expected: false, why: 'a letter among the digits' },
    { pin: '37 9', expected: false, why: 'a space' },
    { pin: ' 3729', expected: false, why: 'untrimmed: shape is judged as stored' },
    { pin: '37.9', expected: false, why: 'punctuation' },
    { pin: '-372', expected: false, why: 'a sign' },
    { pin: '٣٧٢٩', expected: false, why: 'Arabic-Indic digits are not ASCII digits' },

    // one digit, repeated
    { pin: '0000', expected: false, why: 'the default nobody changes' },
    { pin: '1111', expected: false, why: 'all ones' },
    { pin: '9999', expected: false, why: 'all nines' },
    { pin: '55555', expected: false, why: 'five of a kind' },
    { pin: '888888', expected: false, why: 'six of a kind' },

    // ascending runs
    { pin: '0123', expected: false, why: 'ascending from zero' },
    { pin: '1234', expected: false, why: 'the one everybody picks' },
    { pin: '2345', expected: false, why: 'ascending, offset' },
    { pin: '6789', expected: false, why: 'ascending at the top' },
    { pin: '12345', expected: false, why: 'a five-digit run' },
    { pin: '123456', expected: false, why: 'a six-digit run' },

    // descending runs
    { pin: '4321', expected: false, why: 'the mirror of 1234' },
    { pin: '3210', expected: false, why: 'descending to zero' },
    { pin: '9876', expected: false, why: 'descending from the top' },
    { pin: '54321', expected: false, why: 'a five-digit descent' },
    { pin: '654321', expected: false, why: 'a six-digit descent' },
  ];

  for (const { pin, expected, why } of table) {
    it(`${JSON.stringify(pin)} -> ${expected} (${why})`, () => {
      expect(isValidPin(pin)).toBe(expected);
    });
  }

  it('leaves most of the space usable: the weak set is small, not a policy maze', () => {
    let accepted = 0;
    for (let n = 0; n < 10_000; n++) {
      if (isValidPin(String(n).padStart(4, '0'))) accepted++;
    }
    // 10 repeated-digit PINs, 7 ascending runs, 7 descending runs.
    expect(accepted).toBe(10_000 - 24);
  });

  it('pairs the PIN length with a rate limit, since neither stands alone', () => {
    expect(MAX_PIN_ATTEMPTS_PER_HOUR).toBe(5);
  });
});

describe('isValidUsername', () => {
  const table: ReadonlyArray<{ username: string; expected: boolean; why: string }> = [
    { username: 'maria.r', expected: true, why: 'the shape on the login screen' },
    { username: 'abc', expected: true, why: 'exactly the minimum' },
    { username: 'a'.repeat(32), expected: true, why: 'exactly the maximum' },
    { username: 'caja-1', expected: true, why: 'a hyphen' },
    { username: 'caja_1', expected: true, why: 'an underscore' },
    { username: 'm.r-1_2', expected: true, why: 'all three separators together' },
    { username: '123', expected: true, why: 'all digits' },
    { username: '...', expected: true, why: 'all separators: length and charset only' },

    { username: 'ab', expected: false, why: 'one under the minimum' },
    { username: 'a'.repeat(33), expected: false, why: 'one over the maximum' },
    { username: '', expected: false, why: 'empty' },
    { username: 'Maria.R', expected: false, why: 'uppercase would split the UNIQUE index' },
    { username: 'MARIA', expected: false, why: 'all caps' },
    { username: 'maria r', expected: false, why: 'a space' },
    { username: ' maria', expected: false, why: 'a leading space' },
    { username: 'maria ', expected: false, why: 'a trailing space' },
    { username: 'maría', expected: false, why: 'an accented letter' },
    { username: 'maria@espiga.com', expected: false, why: 'an email is not a username' },
    { username: 'maria+1', expected: false, why: 'a plus' },
    { username: 'maria/r', expected: false, why: 'a slash' },
    { username: 'maria\nr', expected: false, why: 'a newline' },
  ];

  for (const { username, expected, why } of table) {
    it(`${JSON.stringify(username)} -> ${expected} (${why})`, () => {
      expect(isValidUsername(username)).toBe(expected);
    });
  }
});
