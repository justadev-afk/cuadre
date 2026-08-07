import { cloudflare } from '@cloudflare/vite-plugin';
import { kvDataAdapter } from '@vinext/cloudflare/cache/kv-data-adapter';
import vinext from 'vinext';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  // The local dev server. 8787 is wrangler's default and what the team points
  // Chrome at during a local run; pinning it keeps that address stable.
  server: { port: 8787 },
  // A background workflow may leave a full repo copy under `.claude/worktrees`;
  // vitest would otherwise run those tests too (doubling the count).
  test: { exclude: [...configDefaults.exclude, '**/.claude/**'] },
  plugins: [
    // No `cdn: cdnAdapter()` and no prerender: every route in the v1 is
    // dynamic and authenticated, so a CDN layer in front of it would only be
    // a cache that never hits. The KV data cache stays because `fetch`
    // caching still needs somewhere to live across isolates — nothing
    // financial goes through it (see `src/adapters/banks/`, all `no-store`).
    vinext({
      cache: { data: kvDataAdapter() },
    }),
    cloudflare({
      viteEnvironment: {
        name: 'rsc',
        childEnvironments: ['ssr'],
      },
    }),
  ],
});
