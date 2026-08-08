import { describe, expect, it } from 'vitest';

import {
  needsShiftConfirmation,
  SHIFT_CONFIRMATION_SECONDS,
  SHIFT_RESUME_GAP_SECONDS,
  shiftAckOnResume,
} from './shift.ts';

const NOW = 1_770_000_000;
const FOUR_HOURS = SHIFT_CONFIRMATION_SECONDS;
const GAP = SHIFT_RESUME_GAP_SECONDS;

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

describe('shiftAckOnResume', () => {
  // A shift that is already due, so a reset is observable as "no longer asks".
  const Due = NOW - FOUR_HOURS;

  const table: ReadonlyArray<{ lastSeenAt: number; expected: number; why: string }> = [
    {
      lastSeenAt: NOW - 30,
      expected: Due,
      why: 'a reload 30s later keeps the clock — F5 cannot dodge it',
    },
    {
      lastSeenAt: NOW - (GAP - 1),
      expected: Due,
      why: 'one second under the gap is still a reload',
    },
    {
      lastSeenAt: NOW - GAP,
      expected: NOW,
      why: 'exactly the gap counts as resumed: the clock restarts',
    },
    {
      lastSeenAt: NOW - (GAP + 3600),
      expected: NOW,
      why: 'a cold start an hour later restarts the clock',
    },
    {
      lastSeenAt: Number.NaN,
      expected: Due,
      why: 'an unusable last-seen leaves the stamp untouched',
    },
  ];

  for (const { lastSeenAt, expected, why } of table) {
    it(why, () => {
      expect(shiftAckOnResume({ shiftAckAt: Due, lastSeenAt, now: NOW })).toBe(expected);
    });
  }

  it('a resumed session no longer needs confirmation', () => {
    const restarted = shiftAckOnResume({ shiftAckAt: Due, lastSeenAt: NOW - GAP, now: NOW });
    expect(needsShiftConfirmation({ shiftAckAt: restarted, now: NOW })).toBe(false);
  });

  it('a quiet reload still faces the prompt', () => {
    const kept = shiftAckOnResume({ shiftAckAt: Due, lastSeenAt: NOW - 5, now: NOW });
    expect(needsShiftConfirmation({ shiftAckAt: kept, now: NOW })).toBe(true);
  });

  it('the resume gap is fifteen minutes', () => {
    expect(SHIFT_RESUME_GAP_SECONDS).toBe(900);
  });
});
