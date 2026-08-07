/**
 * The two literals the persistent-device-id feature shares across the
 * client/server boundary: the `localStorage` key the browser keeps its id
 * under, and the hidden form field name it is posted as.
 *
 * A plain module, not `'use client'`, so a server action can import
 * `DEVICE_ID_FIELD` to read the field without pulling a client component into
 * the server bundle. The client hook in `device-id-field.tsx` imports the same
 * two constants, so the key and the field name live in exactly one place.
 */

/** Mirrors `REMEMBERED_SLUG_KEY` in login-form.tsx: one persistent value per device. */
export const DEVICE_ID_KEY = 'cuadre.device-id';

/** The hidden field the id rides in, read with `textField(form, DEVICE_ID_FIELD)`. */
export const DEVICE_ID_FIELD = 'deviceId';
