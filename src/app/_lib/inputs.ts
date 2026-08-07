/**
 * Reading what arrived with the request: a form field, a query value.
 *
 * `FormData.get` answers `string | File | null`, and a `File` where a text field
 * was expected is a request that did not come from our form. Every reader here
 * collapses that to a string so an action never branches on it.
 */

/**
 * A text field, trimmed. Trailing whitespace on an email or a company code is
 * a phone keyboard's doing, not the person's.
 */
export function textField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * A password or a PIN, exactly as typed. **Never trimmed** — a space is a
 * character somebody may have deliberately chosen, and silently removing it
 * here makes a password that was accepted at sign-up fail at the door.
 */
export function secretField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

/** A checkbox: present means checked, absent means not. */
export function checkedField(form: FormData, name: string): boolean {
  return form.get(name) !== null;
}

export type SearchParams = Record<string, string | string[] | undefined>;

/**
 * One query value. A repeated parameter arrives as an array — the first wins,
 * because a page that reads `?next=/a&next=/b` as "/a,/b" is a page that can be
 * fed a destination it never validated.
 */
export function queryValue(params: SearchParams, name: string): string | null {
  const value = params[name];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
