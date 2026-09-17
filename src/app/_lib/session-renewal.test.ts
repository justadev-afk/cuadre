import { describe, expect, it } from 'vitest';

import { SESSION_MAX_AGE_SECONDS, sessionCookie } from '../../application/session.ts';
import { API } from './endpoints.ts';
import { SESSION_ENDED_PATH } from './session-exit.ts';
import { renewedSessionCookie } from './session-renewal.ts';

const ID = 'a'.repeat(64);

describe('renewedSessionCookie', () => {
  it('hands the cookie back with a fresh lifetime on an ordinary request', () => {
    // The bug: the cookie was only ever written at sign-in, so it died thirty
    // days later under a till whose session was still alive.
    const renewed = renewedSessionCookie('/checkout', ID);

    expect(renewed).toBe(sessionCookie(ID));
    expect(renewed).toContain(`Max-Age=${SESSION_MAX_AGE_SECONDS}`);
  });

  it('renews on the requests an open till makes without navigating', () => {
    expect(renewedSessionCookie('/checkout-express', ID)).not.toBeNull();
    expect(renewedSessionCookie(API.charge, ID)).not.toBeNull();
    expect(renewedSessionCookie('/', ID)).not.toBeNull();
  });

  it('has nothing to renew without a cookie', () => {
    expect(renewedSessionCookie('/checkout', undefined)).toBeNull();
  });

  it('refuses to echo a value this app never minted into a header', () => {
    expect(renewedSessionCookie('/checkout', 'abc; Domain=evil.example')).toBeNull();
    expect(renewedSessionCookie('/checkout', '')).toBeNull();
  });

  const writers: ReadonlyArray<{ path: string; why: string }> = [
    { path: '/logout', why: 'renewing would undo the sign-out' },
    { path: SESSION_ENDED_PATH, why: 'renewing would put back a superseded or revoked cookie' },
    { path: API.signInCompany, why: 'the old id would overwrite the new session' },
    { path: API.signInCashier, why: 'the old id would overwrite the new session' },
    { path: API.signInAdmin, why: 'the old id would overwrite the new session' },
    { path: API.resetPassword, why: 'spending a reset link signs in' },
    { path: '/logout/', why: 'a trailing slash is the same route' },
  ];

  for (const { path, why } of writers) {
    it(`leaves ${path} alone (${why})`, () => {
      expect(renewedSessionCookie(path, ID)).toBeNull();
    });
  }
});
