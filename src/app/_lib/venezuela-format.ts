/**
 * Dates, times and amounts as they are read behind a Venezuelan counter.
 *
 * Every timestamp in this system is epoch seconds and every screen shows it in
 * Caracas local time — UTC−4, no daylight saving — so the offset is arithmetic
 * on the epoch and the `Date` that follows is only ever read through its UTC
 * getters. `Intl` with a `timeZone` would be the other way to do it, and it
 * depends on an ICU build the Worker may or may not carry; `day-range.ts` made
 * the same call for the same reason, and the two have to agree about where a
 * day starts or a row lands under the wrong tab.
 */
import { startOfVenezuelaDay } from '../../application/validations/day-range.ts';
import { formatBolivares } from '../../domain/money.ts';
import { VENEZUELA_UTC_OFFSET_MINUTES } from '../../shared/clock.ts';

const SECONDS_PER_DAY = 86_400;

type LocalParts = {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
};

function localParts(epochSeconds: number): LocalParts {
  const local = new Date((epochSeconds + VENEZUELA_UTC_OFFSET_MINUTES * 60) * 1000);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
  };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** '10:42 a.m.' — the form a receipt prints. */
export function formatTime(epochSeconds: number): string {
  const { hour, minute } = localParts(epochSeconds);
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${pad(minute)} ${hour < 12 ? 'a.m.' : 'p.m.'}`;
}

/** '11:02' — where the column is narrow and the day is already on screen. */
export function formatClock(epochSeconds: number): string {
  const { hour, minute } = localParts(epochSeconds);
  return `${pad(hour)}:${pad(minute)}`;
}

/** '06/08/2026'. */
export function formatDate(epochSeconds: number): string {
  const { year, month, day } = localParts(epochSeconds);
  return `${pad(day)}/${pad(month)}/${year}`;
}

/** '06/08/2026 · 10:42 a.m.' — the receipt line on a confirmed payment. */
export function formatDateTime(epochSeconds: number): string {
  return `${formatDate(epochSeconds)} · ${formatTime(epochSeconds)}`;
}

/**
 * 'hoy 11:02', 'ayer 09:12', '04/08 09:12'.
 *
 * A row three tabs deep still has to say *when*, and "hoy" is what someone
 * standing at a till reads fastest. Older than yesterday it falls back to the
 * date, because "hace 4 días" is not a thing anybody reconciles against.
 */
export function formatDayClock(epochSeconds: number, nowSeconds: number): string {
  const today = startOfVenezuelaDay(nowSeconds);
  if (epochSeconds >= today) return `hoy ${formatClock(epochSeconds)}`;
  if (epochSeconds >= today - SECONDS_PER_DAY) return `ayer ${formatClock(epochSeconds)}`;

  const { day, month } = localParts(epochSeconds);
  return `${pad(day)}/${pad(month)} ${formatClock(epochSeconds)}`;
}

/** '1.240,00' — the digits alone, under a column already headed 'Monto (Bs)'. */
export function amountDigits(cents: number): string {
  return formatBolivares(cents).replace(/^Bs\s*/, '');
}

/** '2,1 s' — how long the bank took, as the confirmation screen states it. */
export function formatSeconds(millis: number): string {
  return `${(millis / 1000).toFixed(1).replace('.', ',')} s`;
}

/** 'MR' — the initials an avatar shows when there is no photograph anywhere. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : '';
  return `${first}${last}`.toUpperCase();
}
