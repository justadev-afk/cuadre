import { fileURLToPath } from 'node:url';
import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { kvDataAdapter } from '@vinext/cloudflare/cache/kv-data-adapter';
import { transform } from 'lightningcss';
import vinext from 'vinext';
import type { Plugin } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';

// Windows 7 stops at Chrome 109, and tills still run it. Tailwind v4 emits CSS
// for Chrome 111+ — `color-mix()`, `lab()`, `oklch()` — which 109 drops as an
// invalid declaration. This lowers every stylesheet the build emits so each of
// those colours carries an rgba fallback in front of it. It works on the final
// assets because vinext builds CSS in its server environments, where Vite's own
// `cssMinify`/`css.lightningcss` settings never reach.
const LEGACY_CHROME = 109;

function legacyCss(): Plugin {
  return {
    name: 'cuadre:legacy-css',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const asset of Object.values(bundle)) {
        if (asset.type !== 'asset' || !asset.fileName.endsWith('.css')) continue;
        asset.source = transform({
          filename: asset.fileName,
          code: Buffer.from(asset.source),
          minify: true,
          targets: { chrome: LEGACY_CHROME << 16 },
        }).code.toString();
      }
    },
  };
}

export default defineConfig({
  // The local dev server. 8787 is wrangler's default and what the team points
  // Chrome at during a local run; pinning it keeps that address stable.
  server: { port: 8787 },
  // `@/` → `src/`, the alias the UI primitives (and shadcn's own generator)
  // use. Vite does not read tsconfig `paths`, so it is declared here too; tsc,
  // vitest and Vite must all agree on it.
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // A background workflow may leave a full repo copy under `.claude/worktrees`;
  // vitest would otherwise run those tests too (doubling the count).
  test: { exclude: [...configDefaults.exclude, '**/.claude/**'] },
  plugins: [
    // Tailwind v4 as a Vite plugin — it scans the source for utility classes
    // and compiles `@import 'tailwindcss'` in globals.css. First in the list so
    // its transform runs before the framework plugins consume the CSS module.
    tailwindcss(),
    // No `cdn: cdnAdapter()` and no prerender: every route in the v1 is
    // dynamic and authenticated, so a CDN layer in front of it would only be
    // a cache that never hits. The KV data cache stays because `fetch`
    // caching still needs somewhere to live across isolates — nothing
    // financial goes through it (see `src/adapters/banks/`, all `no-store`).
    vinext({
      cache: { data: kvDataAdapter() },
    }),
    legacyCss(),
    cloudflare({
      viteEnvironment: {
        name: 'rsc',
        childEnvironments: ['ssr'],
      },
    }),
  ],
});
