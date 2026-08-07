import { describe, expect, it } from 'vitest';

import { needsShiftConfirmation, SHIFT_CONFIRMATION_SECONDS } from './shift.ts';

const NOW = 1_770_000_000;
const FOUR_HOURS = SHIFT_CONFIRMATION_SECONDS;

describe('needsShiftConfirmation', () => {
  const table: ReadonlyArray<{
    shiftAckAt: number | null;
    now: number;
    expected: boolean;
    why: string;
  }> = [
    { shiftAckAt: null, now: NOW, expected: true, why: 'never confirmed' },
    { shiftAckAt: NOW, now: NOW, expected: false, why: 'confirmed this instant' },
    { shiftAckAt: NOW - 1, now: NOW, expected: false, why: 'a second ago' },
    { shiftAckAt: NOW - 3600, now: NOW, expected: false, why: 'an hour into the shift' },
    {
      shiftAckAt: NOW - (FOUR_HOURS - 1),
      now: NOW,
      expected: false,
      why: 'one second before the window closes',
    },
    {
      shiftAckAt: NOW - FOUR_HOURS,
      now: NOW,
      expected: true,
      why: 'exactly four hours: the boundary asks',
    },
    {
      shiftAckAt: NOW - (FOUR_HOURS + 1),
      now: NOW,
      expected: true,
      why: 'one second past',
    },
    {
      shiftAckAt: NOW - 86_400,
      now: NOW,
      expected: true,
      why: 'yesterday',
    },
    { shiftAckAt: 0, now: NOW, expected: true, why: 'the epoch' },

    // untrustworthy stamps must not be what silences the prompt
    { shiftAckAt: NOW + 1, now: NOW, expected: true, why: 'stamped one second in the future' },
    {
      shiftAckAt: NOW + 86_400,
      now: NOW,
      expected: true,
      why: 'stamped tomorrow: a corrupt row asks rather than exempts',
    },
    { shiftAckAt: Number.NaN, now: NOW, expected: true, why: 'NaN' },
    {
      shiftAckAt: Number.POSITIVE_INFINITY,
      now: NOW,
      expected: true,
      why: 'Infinity would otherwise suppress it forever',
    },
    { shiftAckAt: NOW, now: Number.NaN, expected: true, why: 'an unusable clock reading' },
  ];

  for (const { shiftAckAt, now, expected, why } of table) {
    it(`${expected} — ${why}`, () => {
      expect(needsShiftConfirmation({ shiftAckAt, now })).toBe(expected);
    });
  }

  it('is monotonic: once it asks, more time never un-asks', () => {
    const ackAt = NOW - FOUR_HOURS;
    for (const elapsed of [0, 1, 60, 3600, 86_400]) {
      expect(needsShiftConfirmation({ shiftAckAt: ackAt, now: NOW + elapsed })).toBe(true);
    }
  });

  it('measures four hours in seconds, the unit every timestamp column uses', () => {
    expect(SHIFT_CONFIRMATION_SECONDS).toBe(14_400);
  });
});
