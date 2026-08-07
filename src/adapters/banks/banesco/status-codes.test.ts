import { describe, expect, it } from 'vitest';

import type { BankFailure } from '../../../application/ports/bank-gateway.ts';
import { classifyStatus, failureForHttpStatus, isNoResults } from './status-codes.ts';

/**
 * The mapping as the bank documents it. This table is the contract: a change to
 * `status-codes.ts` that is not also a change here is a change nobody agreed to.
 */
const FAILURES: ReadonlyArray<[string, BankFailure]> = [
  ['204', 'no_accounts'],
  ['VDE01', 'invalid_input'],
  ['VDE02', 'invalid_input'],
  ['VRN01', 'rejected_credentials'],
  ['VRN04', 'maintenance'],
  ['VRN05', 'rate_limited'],
  ['VRN06', 'unavailable'],
  ['409', 'unavailable'],
  ['422', 'unavailable'],
  ['500', 'unavailable'],
  ['503', 'unavailable'],
  ['504', 'timeout'],
];

describe('classifyStatus', () => {
  it.each(FAILURES)('maps %s to %s', (code, failure) => {
    expect(classifyStatus(code)).toEqual({ kind: 'failure', failure });
  });

  it('maps 200 to ok', () => {
    expect(classifyStatus('200')).toEqual({ kind: 'ok' });
  });

  it('maps 70001 to no results, which is not a failure', () => {
    expect(classifyStatus('70001')).toEqual({ kind: 'no_results' });
  });

  it('maps 70005 to a range that must be split, which the user never sees', () => {
    expect(classifyStatus('70005')).toEqual({ kind: 'split_range' });
  });

  it('reads a code the bank sent as a number', () => {
    expect(classifyStatus(200)).toEqual({ kind: 'ok' });
    expect(classifyStatus(70001)).toEqual({ kind: 'no_results' });
  });

  it('reads a code with the padding the bank leaves on it', () => {
    expect(classifyStatus(' vrn04 ')).toEqual({ kind: 'failure', failure: 'maintenance' });
  });

  it('treats an unknown code as unavailable rather than as the merchant’s fault', () => {
    expect(classifyStatus('VRN99')).toEqual({ kind: 'failure', failure: 'unavailable' });
  });
});

describe('isNoResults', () => {
  it('is true only for 70001', () => {
    expect(isNoResults('70001')).toBe(true);
    expect(isNoResults(70001)).toBe(true);
    expect(isNoResults('200')).toBe(false);
    expect(isNoResults('VRN01')).toBe(false);
  });
});

describe('failureForHttpStatus', () => {
  it.each([
    [400, 'invalid_input'],
    [401, 'rejected_credentials'],
    [403, 'rejected_credentials'],
    [429, 'rate_limited'],
    [504, 'timeout'],
    [424, 'unavailable'],
    [502, 'unavailable'],
  ] as ReadonlyArray<[number, BankFailure]>)('maps HTTP %i to %s', (status, failure) => {
    expect(failureForHttpStatus(status)).toBe(failure);
  });
});
