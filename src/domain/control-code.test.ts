import { describe, expect, it } from 'vitest';

import { fakeIdGen, type IdGen } from '../shared/id.ts';
import {
  CONTROL_CODE_LENGTH,
  CONTROL_CODE_MAX_ATTEMPTS,
  generateControlCode,
} from './control-code.ts';

/** Records what was asked of the port, so the length is a contract, not a hope. */
function recordingIdGen(values: readonly string[]): { ids: IdGen; asked: number[] } {
  const asked: number[] = [];
  const queue = [...values];
  const ids: IdGen = {
    uuid: () => 'unused',
    digits: (count) => {
      asked.push(count);
      return queue.shift() ?? '';
    },
    token: () => 'unused',
  };
  return { ids, asked };
}

describe('generateControlCode', () => {
  const table: ReadonlyArray<{ drawn: string; why: string }> = [
    { drawn: '123456', why: 'an ordinary code' },
    { drawn: '000000', why: 'all zeros is a legal code, not a failure' },
    { drawn: '999999', why: 'the top of the range' },
    { drawn: '000001', why: 'leading zeros survive: this is a string, never a number' },
    { drawn: '100000', why: 'no zero is trimmed off the front' },
  ];

  for (const { drawn, why } of table) {
    it(`returns the digits the port drew: ${drawn} (${why})`, () => {
      const { ids } = recordingIdGen([drawn]);
      expect(generateControlCode(ids)).toBe(drawn);
    });
  }

  it('always asks the port for exactly CONTROL_CODE_LENGTH digits', () => {
    const { ids, asked } = recordingIdGen(['111111', '222222', '333333']);
    generateControlCode(ids);
    generateControlCode(ids);
    generateControlCode(ids);
    expect(asked).toEqual([6, 6, 6]);
    expect(CONTROL_CODE_LENGTH).toBe(6);
  });

  it('draws again on every call rather than caching', () => {
    const ids = fakeIdGen({ digits: ['111111', '222222'] });
    expect(generateControlCode(ids)).toBe('111111');
    expect(generateControlCode(ids)).toBe('222222');
  });

  it('is pure with respect to the port: same queue, same sequence', () => {
    const first = fakeIdGen({ digits: ['424242'] });
    const second = fakeIdGen({ digits: ['424242'] });
    expect(generateControlCode(first)).toBe(generateControlCode(second));
  });
});

describe('CONTROL_CODE_MAX_ATTEMPTS', () => {
  it('leaves room to retry a UNIQUE collision without retrying forever', () => {
    expect(CONTROL_CODE_MAX_ATTEMPTS).toBe(3);
    expect(CONTROL_CODE_MAX_ATTEMPTS).toBeGreaterThan(1);
  });
});
