/**
 * Two things a server action needs off the incoming request, and one guard.
 *
 * The IP is hashed the moment it is read and never stored raw — the use cases
 * take `ipHash`, never an address, so this is where the pepper is applied and
 * the only place the real IP is briefly in hand.
 */
import { env } from 'cloudflare:workers';
import { headers } from 'next/headers';
import type { Bindings } from '../../env.ts';
import { hashIp } from '../../shared/crypto.ts';

/**
 * `CF-Connecting-IP` is the client address Cloudflare puts on every request;
 * it cannot be spoofed by a header the client sets because the edge overwrites
 * it. `x-forwarded-for` is the dev-server fallback. An absent IP hashes to a
 * stable sentinel rather than throwing — a rate limit keyed on "unknown" is
 * still a rate limit.
 */
export async function callerIpHash(): Promise<string> {
  const store = await headers();
  const ip =
    store.get('cf-connecting-ip') ?? store.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
  const pepper = (env as unknown as Bindings).IP_PEPPER;
  return hashIp(ip.trim(), pepper);
}
