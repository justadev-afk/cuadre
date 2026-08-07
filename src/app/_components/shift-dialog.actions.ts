'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { container, currentSession } from '../_lib/current-session.ts';

/**
 * *Sigo yo, continuar* — the four-hour prompt's only mutation.
 *
 * The session id comes from the cookie and never from the form: the whole point
 * of the prompt is that whoever is at the till answers for *this* session, and
 * a hidden field carrying an id would be a field someone can change. Nothing
 * logs out on its own if the prompt is ignored, so there is no failure path
 * beyond "that session is already gone", which is a trip back to the login
 * screen.
 */
export async function acknowledgeShiftAction(): Promise<void> {
  const resolved = await currentSession();
  if (resolved === null) redirect('/login');

  const session = await container().auth.acknowledgeShift({ sessionId: resolved.sessionId });
  if (session === null) redirect('/login');

  // The prompt lives in a layout, so the whole shell has to re-render for it to
  // come down — the page under it did not change.
  revalidatePath('/', 'layout');
}
