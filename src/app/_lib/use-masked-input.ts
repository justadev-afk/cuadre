'use client';

/**
 * A masked field somebody can still edit *in the middle of*.
 *
 * A mask that only formats — `onChange={(e) => set(mask(e.target.value))}` — is
 * correct for as long as the caret is at the end, and unusable the moment it is
 * not: the value is rewritten, React writes it back into the DOM, and the caret
 * lands at the far end of a number that has just shifted under it. Fixing one
 * wrong digit of a phone number then breaks the rest of it.
 *
 * Two things are needed to make the field ordinary again, and neither belongs
 * in the mask itself (`masks.ts` stays pure text-in, text-out):
 *
 *  - **The caret survives the re-format**, counted in digits (`remask`). It is
 *    put back synchronously, on the DOM node, before React re-renders — and
 *    again in a layout effect afterwards, because React writes the value itself
 *    when its own state finally lands.
 *  - **Backspace over a separator deletes a digit.** The separators are the
 *    mask's: deleting the hyphen out of `0414-3125566` leaves a value the mask
 *    puts straight back, so the key does nothing and the field reads as frozen.
 *    Stepping the caret past the separator first means the keystroke takes the
 *    digit it was aimed at, which is what the person meant by pressing it.
 */
import { type ChangeEvent, type KeyboardEvent, useLayoutEffect, useRef } from 'react';

import { remask } from './masks.ts';

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= '0' && character <= '9';
}

export function useMaskedInput(mask: (raw: string) => string, commit: (value: string) => void) {
  const ref = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const input = ref.current;
    if (input === null || caret.current === null) return;
    input.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });

  return {
    ref,
    onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
      const input = event.currentTarget;
      const at = input.selectionStart;
      // Only a bare caret — a selection is already telling the key what to eat.
      if (at === null || at !== input.selectionEnd) return;
      if (event.key === 'Backspace' && at > 0 && !isDigit(input.value[at - 1])) {
        input.setSelectionRange(at - 1, at - 1);
      } else if (event.key === 'Delete' && !isDigit(input.value[at]) && at < input.value.length) {
        input.setSelectionRange(at + 1, at + 1);
      }
    },
    onChange(event: ChangeEvent<HTMLInputElement>): void {
      const input = event.currentTarget;
      const edit = remask(input.value, input.selectionStart ?? input.value.length, mask);
      // The DOM first, so the value React is about to render is already the one
      // in the field and React has nothing to write — that is what keeps the
      // caret from jumping on the keystrokes where the mask changed nothing.
      input.value = edit.value;
      input.setSelectionRange(edit.caret, edit.caret);
      caret.current = edit.caret;
      commit(edit.value);
    },
  };
}
