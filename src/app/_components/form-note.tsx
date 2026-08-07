/**
 * The line a form shows after it answers: a refusal, or a confirmation.
 *
 * `role="alert"` on the refusal so a screen reader hears it without hunting for
 * what changed; `role="status"` on the confirmation, which is not urgent. The
 * palette has no red — Nocturne is accent plus neutrals — so the icon is what
 * separates the two, and the copy says the rest.
 */
import { Icon } from './icon.tsx';

type FormNoteProps = {
  tone: 'error' | 'success';
  children: string;
};

export function FormNote({ tone, children }: FormNoteProps) {
  return (
    <p className="form-note" role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name={tone === 'error' ? 'warning-circle' : 'check-circle'} />
      <span>{children}</span>
    </p>
  );
}
