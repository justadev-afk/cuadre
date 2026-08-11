import { describe, expect, it } from 'vitest';

import {
  type ExpectedPayment,
  fullestReference,
  type MatchableMovement,
  matchPayment,
  type PaymentVerdict,
  paymentKey,
  type RejectionReason,
  sameReference,
} from './payment-match.ts';

const NOW = 1_770_000_000;

const EXPECTED: ExpectedPayment = { reference: '123456789', amountCents: 124000 };

/** A movement that matches `EXPECTED` in every respect. Rows below break one. */
const GOOD: MatchableMovement = {
  reference: '123456789',
  amountCents: 124000,
  currency: 'BS ',
  isCredit: true,
};

const approved: PaymentVerdict = { kind: 'approved' };
const notFound: PaymentVerdict = { kind: 'not_found' };
const reject = (reason: RejectionReason): PaymentVerdict => ({ kind: 'rejected', reason });

describe('matchPayment', () => {
  const table: ReadonlyArray<{
    movement: MatchableMovement | null;
    expected?: ExpectedPayment;
    verdict: PaymentVerdict;
    why: string;
  }> = [
    // ── the only way to approve ──────────────────────────────────────────
    { movement: GOOD, verdict: approved, why: 'every rule holds' },
    {
      movement: { ...GOOD, currency: 'BS' },
      verdict: approved,
      why: 'the currency without the trailing space',
    },
    {
      movement: { ...GOOD, currency: 'bs' },
      verdict: approved,
      why: 'and in lower case',
    },

    // ── the bank has nothing ─────────────────────────────────────────────
    {
      movement: null,
      verdict: notFound,
      why: 'no movement is "not reported yet", never a rejection',
    },

    // ── a debit is not money in ──────────────────────────────────────────
    {
      movement: { ...GOOD, isCredit: false },
      verdict: reject('not_a_credit'),
      why: 'the merchant paid out; nothing arrived',
    },

    // ── currency ─────────────────────────────────────────────────────────
    {
      movement: { ...GOOD, currency: 'USD' },
      verdict: reject('unsupported_currency'),
      why: 'dollars are not settled here',
    },
    {
      movement: { ...GOOD, currency: '' },
      verdict: reject('unsupported_currency'),
      why: 'a missing currency is not an assumed one',
    },
    {
      movement: { ...GOOD, currency: 'VES' },
      verdict: reject('unsupported_currency'),
      why: 'the ISO code is not what the bank sends',
    },

    // ── the reference ────────────────────────────────────────────────────
    {
      movement: { ...GOOD, reference: '987654321' },
      verdict: reject('reference_mismatch'),
      why: 'a different payment entirely',
    },
    {
      movement: { ...GOOD, reference: '12345678' },
      verdict: reject('reference_mismatch'),
      why: 'one digit short is a different reference, not a near miss',
    },
    {
      movement: { ...GOOD, reference: '1234567890' },
      verdict: reject('reference_mismatch'),
      why: 'a trailing digit is not padding',
    },
    {
      movement: { ...GOOD, reference: '0000123456789' },
      verdict: approved,
      why: 'leading zeros are the bank padding to its own width',
    },
    {
      movement: { ...GOOD, reference: '123456789' },
      expected: { ...EXPECTED, reference: '000123456789' },
      verdict: approved,
      why: 'and the cashier copying the padded form off a receipt',
    },
    {
      movement: { ...GOOD, reference: ' 123 456 789 ' },
      verdict: approved,
      why: 'spaces in a printed reference are grouping',
    },
    {
      movement: { ...GOOD, reference: '' },
      verdict: reject('reference_mismatch'),
      why: 'an empty reference matches nothing',
    },
    {
      movement: { ...GOOD, reference: '' },
      expected: { ...EXPECTED, reference: '' },
      verdict: reject('reference_mismatch'),
      why: 'including another empty one: two blanks are not a match',
    },
    {
      movement: { ...GOOD, reference: '000' },
      expected: { ...EXPECTED, reference: '0' },
      verdict: approved,
      why: 'zero survives its own padding',
    },
    {
      movement: { ...GOOD, reference: '000' },
      expected: { ...EXPECTED, reference: '' },
      verdict: reject('reference_mismatch'),
      why: 'padding never collapses all the way to nothing',
    },
    {
      movement: { ...GOOD, reference: 'AB123' },
      expected: { ...EXPECTED, reference: 'ab123' },
      verdict: approved,
      why: 'case folds, for a bank that ever returns letters',
    },

    // ── the amount, exactly ──────────────────────────────────────────────
    {
      movement: { ...GOOD, amountCents: 123999 },
      verdict: reject('amount_mismatch'),
      why: 'one cent short: there is no tolerance',
    },
    {
      movement: { ...GOOD, amountCents: 124001 },
      verdict: reject('amount_mismatch'),
      why: 'one cent over is not a tip',
    },
    {
      movement: { ...GOOD, amountCents: 1240 },
      verdict: reject('amount_mismatch'),
      why: 'bolívares mistaken for cents',
    },
    {
      movement: { ...GOOD, amountCents: 12400000 },
      verdict: reject('amount_mismatch'),
      why: 'and cents mistaken for bolívares',
    },
    {
      movement: { ...GOOD, amountCents: 0 },
      verdict: reject('amount_mismatch'),
      why: 'a zero movement',
    },
    {
      movement: { ...GOOD, amountCents: -124000 },
      verdict: reject('amount_mismatch'),
      why: 'the right magnitude, the wrong direction',
    },

    // ── a float must never approve ───────────────────────────────────────
    {
      movement: { ...GOOD, amountCents: 124000.0000001 },
      verdict: reject('amount_mismatch'),
      why: 'a float that is nearly right is refused, not compared',
    },
    {
      movement: { ...GOOD, amountCents: 0.1 + 0.2 },
      verdict: reject('amount_mismatch'),
      why: 'the canonical floating-point residue',
    },
    {
      movement: { ...GOOD, amountCents: Number.NaN },
      verdict: reject('amount_mismatch'),
      why: 'NaN compares false against everything, but say why explicitly',
    },
    {
      movement: { ...GOOD, amountCents: Number.POSITIVE_INFINITY },
      verdict: reject('amount_mismatch'),
      why: 'Infinity',
    },
    {
      movement: GOOD,
      expected: { ...EXPECTED, amountCents: 124000.5 },
      verdict: reject('amount_mismatch'),
      why: 'a non-integer on the expected side is refused too',
    },
    {
      movement: { ...GOOD, amountCents: 0 },
      expected: { ...EXPECTED, amountCents: 0 },
      verdict: reject('amount_mismatch'),
      why: 'zero equals zero and is still refused: amount_cents CHECK (> 0)',
    },
    {
      movement: { ...GOOD, amountCents: -124000 },
      expected: { ...EXPECTED, amountCents: -124000 },
      verdict: reject('amount_mismatch'),
      why: 'and two matching negatives are refused for the same reason',
    },

    // ── precedence when several rules fail at once ───────────────────────
    {
      movement: { ...GOOD, isCredit: false, currency: 'USD', reference: 'x', amountCents: 1 },
      verdict: reject('not_a_credit'),
      why: 'the most fundamental failure is the one reported',
    },
    {
      movement: { ...GOOD, currency: 'USD', reference: 'x', amountCents: 1 },
      verdict: reject('unsupported_currency'),
      why: 'then the currency',
    },
    {
      movement: { ...GOOD, reference: 'x', amountCents: 1 },
      verdict: reject('reference_mismatch'),
      why: 'then which payment it is',
    },
    {
      movement: { ...GOOD, amountCents: 1 },
      verdict: reject('amount_mismatch'),
      why: 'and only then how much it was',
    },
  ];

  for (const { movement, expected, verdict, why } of table) {
    it(`${JSON.stringify(verdict)} — ${why}`, () => {
      expect(matchPayment({ movement, expected: expected ?? EXPECTED, now: NOW })).toEqual(verdict);
    });
  }

  it('never approves without a movement, whatever the claim says', () => {
    // The invariant, stated as a test: approval is born from the bank's
    // movement. There is no `expected` that can produce one on its own.
    for (const reference of ['123456789', '', '0', 'anything']) {
      for (const amountCents of [124000, 0, -1, 1]) {
        const expected = { reference, amountCents };
        expect(matchPayment({ movement: null, expected, now: NOW })).toEqual(notFound);
      }
    }
  });

  it('does not depend on the instant it is asked', () => {
    for (const now of [0, 1, NOW, NOW + 86_400, Number.MAX_SAFE_INTEGER]) {
      expect(matchPayment({ movement: GOOD, expected: EXPECTED, now })).toEqual(approved);
      expect(matchPayment({ movement: null, expected: EXPECTED, now })).toEqual(notFound);
    }
  });
});

/**
 * The tail rule, as a table. The counter types the last few digits and the bank
 * answers with the whole number, so one is the suffix of the other — but only
 * down to a floor, below which a shared ending is a coincidence and not a
 * payment.
 */
describe('sameReference', () => {
  const table: ReadonlyArray<[string, string, boolean, string]> = [
    ['000123456789', '456789', true, 'the bank answers in full what we asked by tail'],
    ['456789', '000123456789', true, 'and the other way round'],
    ['12346090431', '090431', true, 'a tail that begins with a zero is still six digits'],
    ['00000150496', '150496', true, 'padding alone is never a different payment'],
    ['150496', '00000150496', true, 'whichever side carries it'],
    ['000123456789', '000123456789', true, 'identical is identical'],
    ['000123456789', '999999', false, 'a different tail is a different payment'],
    ['000123456789', '56789', false, 'five digits is below the floor, so it is refused'],
    ['123456', '', false, 'an empty reference matches nothing'],
    ['', '123456', false, 'including from the other side'],
    ['', '', false, 'and two empties are not each other'],
  ];

  for (const [actual, expected, same, why] of table) {
    it(`${same ? 'matches' : 'refuses'} ${actual || '∅'} vs ${expected || '∅'} — ${why}`, () => {
      expect(sameReference(actual, expected)).toBe(same);
    });
  }
});

/**
 * Which spelling the row keeps. The table is the specification of what a
 * customer reads back off a receipt, so a change here is a change to what the
 * counter can settle an argument with.
 */
describe('fullestReference', () => {
  const table: ReadonlyArray<[string, string, string, string]> = [
    [
      '12346090431',
      '090431',
      '12346090431',
      'a pago móvil asked by its tail keeps the bank’s whole number',
    ],
    [
      '150496',
      '00000150496',
      '00000150496',
      'a transferencia keeps the receipt’s padding the bank dropped',
    ],
    ['00000150496', '00000150496', '00000150496', 'identical spellings change nothing'],
    ['150496', '150496', '150496', 'and neither does an unpadded pair'],
    ['12346085878', '', '12346085878', 'nothing typed leaves the bank’s spelling alone'],
  ];

  for (const [reported, typed, kept, why] of table) {
    it(`keeps ${kept} from ${reported}/${typed || '∅'} — ${why}`, () => {
      expect(fullestReference(reported, typed)).toBe(kept);
    });
  }

  it('never invents a spelling neither side sent', () => {
    const kept = fullestReference('150496', '00000150496');
    expect(['150496', '00000150496']).toContain(kept);
  });
});

/**
 * What a payment is charged under. The table is the specification of the
 * anti-double-charge index, so a change here is a change to what "the same
 * payment" means.
 */
describe('paymentKey', () => {
  const onDate = '2026-08-11';

  it('is the bank’s canonical reference when the bank told us the whole thing', () => {
    expect(paymentKey({ reference: '000123456789', occurredOn: onDate, askedDigits: 6 })).toBe(
      '123456789',
    );
  });

  it('folds padding, so two spellings of one payment collide', () => {
    const padded = paymentKey({ reference: '00000150496', occurredOn: onDate, askedDigits: 6 });
    const bare = paymentKey({ reference: '150496000', occurredOn: onDate, askedDigits: 6 });
    expect(padded).toBe('150496');
    expect(bare).not.toBe(padded);
  });

  it('pairs a bare tail with the day, because six digits identify nothing', () => {
    expect(paymentKey({ reference: '456789', occurredOn: onDate, askedDigits: 6 })).toBe(
      `456789@${onDate}`,
    );
  });

  it('counts the digits as they arrived, so a padded tail is still a tail', () => {
    // '090431' canonicalises to '90431'; counting that would call six digits
    // five and read a tail as a full reference.
    expect(paymentKey({ reference: '090431', occurredOn: onDate, askedDigits: 6 })).toBe(
      `90431@${onDate}`,
    );
  });

  it('separates the same tail on two different days', () => {
    const monday = paymentKey({ reference: '456789', occurredOn: '2026-08-10', askedDigits: 6 });
    const tuesday = paymentKey({ reference: '456789', occurredOn: '2026-08-11', askedDigits: 6 });
    expect(monday).not.toBe(tuesday);
  });

  it('takes the bank’s own digit count, not a hard-coded six', () => {
    // A bank asked with eight digits reports eight: still a tail, still dated.
    expect(paymentKey({ reference: '23456789', occurredOn: onDate, askedDigits: 8 })).toBe(
      `23456789@${onDate}`,
    );
    expect(paymentKey({ reference: '23456789', occurredOn: onDate, askedDigits: 6 })).toBe(
      '23456789',
    );
  });
});
