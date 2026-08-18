/**
 * The spans the statistics screen offers, and what each is called.
 *
 * Its own module, and deliberately not part of `range-filter.tsx`: that file is
 * `'use client'`, and a *value* imported out of a client module across the RSC
 * boundary arrives as a client reference, not as the array — the page would get
 * a proxy and `RANGE_OPTIONS.find` would not be a function. Anything both the
 * server render and the browser read has to live in a plain module like this one.
 *
 * The order is the order a shopkeeper reaches for them, not alphabetical.
 */
import type { StatsRangePreset } from '../../../application/validations/day-range.ts';

export type RangeOption = { readonly value: StatsRangePreset; readonly label: string };

export const RANGE_OPTIONS: readonly RangeOption[] = [
  { value: 'today', label: 'Hoy' },
  { value: 'yesterday', label: 'Ayer' },
  { value: 'last_7_days', label: 'Últimos 7 días' },
  { value: 'last_30_days', label: 'Últimos 30 días' },
  { value: 'this_month', label: 'Este mes' },
  { value: 'last_month', label: 'Mes pasado' },
];
