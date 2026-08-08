/**
 * Client-side feature flags — small switches the maintainer flips and pushes.
 *
 * A push auto-deploys, so flipping one here and pushing turns it on or off in
 * production within a couple of minutes. Not runtime config; a deliberate,
 * reviewable constant.
 */

/**
 * Whether the installed PWA resizes its own window per screen (compact till,
 * roomy panels). Only ever acts inside an installed PWA and clamps to the
 * screen, but window-resizing is browser-dependent — this is the kill switch if
 * it behaves badly anywhere. Set to `false` and push to disable.
 */
export const PWA_RESIZE_ENABLED = true;
