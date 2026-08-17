/**
 * `/reset-password?token=…` — the shape the mail links to.
 *
 * The screen itself is `/reset-password/<token>`, and the link in the inbox is
 * built by `application/auth/request-password-reset.ts` with the token on the
 * query string. Both spellings are already out in people's mail, so this is the
 * bridge: read the token, forward to the screen, and keep the one form that
 * asks for a new password. Changing the mail alone would fix tomorrow's links
 * and leave every link already sent landing on a 404.
 *
 * Nothing is checked here — the token is spent when the form is submitted, not
 * when the URL is opened, so a mail scanner following the link does not burn it.
 * `encodeURIComponent` is what stops a crafted `?token=../admin` from becoming a
 * path: a slash cannot survive it.
 */
import { redirect } from 'next/navigation';

import { queryValue, type SearchParams } from '../_lib/inputs.ts';

export default async function ResetPasswordEntry({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const token = queryValue(await searchParams, 'token') ?? '';

  // No token at all: there is nothing to reset, and the honest next step is
  // asking for a link rather than a form that can only refuse.
  if (token === '') redirect('/forgot-password');

  redirect(`/reset-password/${encodeURIComponent(token)}`);
}
