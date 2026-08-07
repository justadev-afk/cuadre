import { describe, expect, it } from 'vitest';

import { epochToIso } from '../../shared/clock.ts';
import { makeFakeD1 } from './d1.fake.ts';
import { D1PasswordResetRepository, toPasswordReset } from './password-reset.repository.ts';

const TOKEN_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

// Timestamp columns hold ISO-8601 UTC text since migration 0004; the repo maps
// them back to epoch seconds, and binds its epoch comparisons as ISO too.
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    token_hash: TOKEN_HASH,
    user_id: 'user-1',
    expires_at: epochToIso(1_770_001_800),
    used_at: null,
    requested_ip: 'b1946ac92492d2347c6235b4d2611184',
    created_at: epochToIso(1_770_000_000),
    ...overrides,
  };
}

describe('toPasswordReset', () => {
  it('maps a row', () => {
    expect(toPasswordReset(row())).toEqual({
      tokenHash: TOKEN_HASH,
      userId: 'user-1',
      expiresAt: 1_770_001_800,
      usedAt: null,
      requestedIpHash: 'b1946ac92492d2347c6235b4d2611184',
      createdAt: 1_770_000_000,
    });
  });

  it('names the requested_ip column for what it holds: a hash', () => {
    const reset = toPasswordReset(row());
    expect(reset).toHaveProperty('requestedIpHash');
    expect(reset).not.toHaveProperty('requestedIp');
  });

  it('tolerates a reset requested with no address recorded', () => {
    expect(toPasswordReset(row({ requested_ip: null })).requestedIpHash).toBeNull();
  });

  it('carries the spend instant once used', () => {
    expect(toPasswordReset(row({ used_at: epochToIso(1_770_000_120) })).usedAt).toBe(1_770_000_120);
  });
});

describe('create', () => {
  it('stores the hash and never a token', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [], changes: 1 });

    await new D1PasswordResetRepository(fake.db).create({
      tokenHash: TOKEN_HASH,
      userId: 'user-1',
      expiresAt: 1_770_001_800,
      requestedIpHash: 'b1946ac92492d2347c6235b4d2611184',
      createdAt: 1_770_000_000,
    });

    expect(fake.calls[0]?.args).toEqual([
      TOKEN_HASH,
      'user-1',
      epochToIso(1_770_001_800),
      'b1946ac92492d2347c6235b4d2611184',
      epochToIso(1_770_000_000),
    ]);
  });
});

describe('markUsed', () => {
  it('makes the token single-use inside the UPDATE, not before it', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [], changes: 1 });

    const spent = await new D1PasswordResetRepository(fake.db).markUsed(TOKEN_HASH, 1_770_000_120);

    expect(fake.calls[0]?.sql).toContain('used_at IS NULL');
    expect(fake.calls[0]?.sql).toContain('expires_at > ?');
    expect(fake.calls[0]?.args).toEqual([
      epochToIso(1_770_000_120),
      TOKEN_HASH,
      epochToIso(1_770_000_120),
    ]);
    expect(spent).toBe(true);
  });

  it('refuses a second click on the same mailed link', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [], changes: 0 });

    expect(await new D1PasswordResetRepository(fake.db).markUsed(TOKEN_HASH, 1)).toBe(false);
  });
});

describe('invalidateAllForUser', () => {
  it('marks the outstanding tokens spent and keeps the audit rows', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [], changes: 3 });

    const burned = await new D1PasswordResetRepository(fake.db).invalidateAllForUser('user-1', 5);

    expect(fake.calls[0]?.sql).toContain('UPDATE password_resets');
    expect(fake.calls[0]?.sql).not.toContain('DELETE');
    expect(burned).toBe(3);
  });
});

describe('countRecentForUser', () => {
  it('counts requests inside the window, spent or not', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [{ total: 3 }] });

    const count = await new D1PasswordResetRepository(fake.db).countRecentForUser(
      'user-1',
      1_769_996_400,
    );

    expect(fake.calls[0]?.sql).not.toContain('used_at');
    expect(fake.calls[0]?.args).toEqual(['user-1', epochToIso(1_769_996_400)]);
    expect(count).toBe(3);
  });

  it('reads no rows as zero', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [] });

    expect(await new D1PasswordResetRepository(fake.db).countRecentForUser('ghost', 0)).toBe(0);
  });
});
