/**
 * Where the mark lives, and which cut of it is current.
 *
 * The icon files have stable names — `/icons/512.png` is always the 512 — which
 * is right for reading and wrong for *replacing*: when the drawing changed from
 * a phone to a tablet the bytes moved and the URL did not, so nothing anywhere
 * had a reason to fetch it again. An installed PWA keeps the icon it was
 * installed with until the **manifest changes**, and a manifest listing the same
 * three URLs as yesterday has not changed. Neither had the service worker's
 * copy, cached under the same path.
 *
 * So the version is in the URL. Bumping `ICON_VERSION` rewrites every icon
 * reference at once — the manifest, the favicon, the touch icon and the mark in
 * the app header — which makes the manifest a different document, the browser
 * ask for icons it has never seen, and the caches miss on purpose. It is
 * declared here and read everywhere, because a version that lives in four files
 * is a version that gets bumped in three of them (§11).
 *
 * **Bump this whenever the artwork in `public/icons/` changes.** Nothing else
 * makes an installed app show it. (iOS is the exception it always is: a home
 * screen icon there is stamped at "añadir a inicio" and only a reinstall
 * replaces it.)
 */
export const ICON_VERSION = '2';

/** `/icons/512.png` → `/icons/512.png?v=2`. The only way an icon is referenced. */
export function brandIcon(file: string): string {
  return `/icons/${file}?v=${ICON_VERSION}`;
}

/** The `.ico` sits at the root rather than in `icons/`, and versions the same. */
export function faviconIco(): string {
  return `/favicon.ico?v=${ICON_VERSION}`;
}
