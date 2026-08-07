import { describe, expect, it } from 'vitest';

import {
  type ExpectedPayment,
  type MatchableMovement,
  matchPayment,
  type PaymentVerdict,
  type RejectionReason,
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
