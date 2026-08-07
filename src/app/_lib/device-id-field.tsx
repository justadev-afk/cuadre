'use client';

/**
 * A persistent device id, minted once per browser and posted on every sign-in.
 *
 * It is what tells "signed in on another device" apart from "signed in again on
 * this one": the id is stamped onto the session record and the per-user active
 * pointer, and the resolve path compares them. It is not a credential — it only
 * labels the "session ended" modal — so it is never masked or rate-limited.
 */

import { useEffect, useState } from 'react';

import { DEVICE_ID_FIELD, DEVICE_ID_KEY } from './device-id.ts';

/**
 * The id for this browser, or `''` until the mount effect has run. It is read
 * (and created) in `useEffect`, never during render — the server has no
 * `localStorage`, so touching it during render would be a hydration mismatch,
 * the same reason the cashier slug is read after mount in login-form.tsx.
 */
export function useDeviceId(): string {
  const [deviceId, setDeviceId] = useState('');

  useEffect(() => {
    let stored = window.localStorage.getItem(DEVICE_ID_KEY);
    if (stored === null || stored === '') {
      stored = crypto.randomUUID();
      window.localStorage.setItem(DEVICE_ID_KEY, stored);
    }
    setDeviceId(stored);
  }, []);

  return deviceId;
}

/**
 * The hidden field the id posts through. Empty on the very first paint before
 * the effect runs; the use case tolerates an empty id, so a submission that
 * races the effect still supersedes — only the same-device labelling degrades.
 */
export function DeviceIdField() {
  const deviceId = useDeviceId();
  return <input type="hidden" name={DEVICE_ID_FIELD} value={deviceId} />;
}
