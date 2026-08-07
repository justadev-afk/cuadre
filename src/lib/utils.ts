import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * The one class-name joiner every UI primitive uses: `clsx` resolves
 * conditionals and `tailwind-merge` collapses conflicting Tailwind utilities so
 * a caller's `className` always wins over a component's default (e.g. a passed
 * `px-6` replaces a built-in `px-4` rather than fighting it).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
