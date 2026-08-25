/**
 * Which payer bank this till used last, remembered in a **cookie** rather than
 * in `localStorage`.
 *
 * The bank is the one field a cashier picks rather than reads, and it repeats
 * all shift: a bakery beside a Banesco branch sees the same bank all day. So the
 * till preselects the last pick — and that preselection has to be there in the
 * *first* paint.
 *
 * `localStorage` cannot do that. The server has none, so a remembered value can
 * only be read after mount, and the till necessarily paints once with an empty
 * picker before correcting itself. That blink is tolerable on the login screen
 * (`login-form.tsx` does exactly this) and it is not here: a custom payer brand
 * dictates the phone field too, so the correction moves two fields at once,
 * right where a cashier is already typing.
 *
 * A cookie is the same fact in a place the server can read. It is written from
 * the browser — nothing here needs a round trip to remember a dropdown — and
 * read by `CheckoutContent`, which resolves the bank *and* the phone it dictates
 * into the form's initial state. Server and client then render the same markup,
 * which is the other half of why there is no blink: a value read during render
 * has to survive hydration.
 *
 * Not a secret and not scoped like one: a four-digit public bank code, readable
 * by the script that writes it, on the same origin that already carries the
 * session. It is a preference, and the worst a tampered one can do is preselect
 * a bank the cashier then changes — the claim is validated against the
 * catalogue on the way in either way.
 */

/** Named once. The browser writes it and `CheckoutContent` reads it. */
export const LAST_PAYER_BANK_COOKIE = 'cuadre.last-payer-bank';

/** A till's habit outlives a shift, a holiday and a phone reboot. */
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Remembers the pick, from the browser.
 *
 * `Secure` only where the page is: a `Secure` cookie set over plain http is
 * dropped silently, and the one place that happens is a developer's machine —
 * where a till that forgets its bank on every reload is a bug nobody can
 * reproduce in production.
 */
export function rememberPayerBank(code: string): void {
  if (code === '') return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API this suggests is not in Safari, and the express till is an iPhone PWA — a feature-detected pair of writers would be two spellings of one cookie (§11).
  document.cookie = `${LAST_PAYER_BANK_COOKIE}=${encodeURIComponent(code)}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax${secure}`;
}
