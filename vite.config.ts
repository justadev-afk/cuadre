import { cloudflare } from '@cloudflare/vite-plugin';
import { kvDataAdapter } from '@vinext/cloudflare/cache/kv-data-adapter';
import vinext from 'vinext';
import { defineConfig } from 'vite';

export default defineConfig({
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
