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
 * `YYYY-MM-DD` for a calendar day the *user* picked, read off a `Date` the
 * picker built in local time.
 *
 * Deliberately not `toISOString().slice(0, 10)`: that converts to UTC first, so
 * a day chosen anywhere west of Greenwich comes back as the day before — which
 * on this field would send the bank the wrong `startDt` and make a real payment
 * unfindable. The picker already yields the day the cashier sees; this only
 * spells it.
 */
export function toIsoDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * A `YYYY-MM-DD` back to a `Date` at local midnight — the inverse of
 * `toIsoDay`, and the shape react-day-picker wants for its selection.
 */
export function fromIsoDay(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

/**
 * Today, at the counter — `YYYY-MM-DD` in Caracas, read fresh from the clock.
 *
 * Read at the moment it is needed, never cached into a render: a till stays open
 * all night, and a "today" resolved when the page loaded would still call itself
 * today at eight in the morning while meaning yesterday. The offset is
 * arithmetic on the epoch rather than an `Intl` timezone, which is the same
 * choice the rest of this file and `day-range.ts` make, so they cannot disagree
 * about where a day starts.
 */
export function venezuelaToday(): string {
  const { year, month, day } = localParts(Math.floor(Date.now() / 1000));
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** The day before that, for the "Ayer" label. */
export function yesterdayInVenezuela(): string {
  const { year, month, day } = localParts(Math.floor(Date.now() / 1000) - SECONDS_PER_DAY);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** 'hoy', 'ayer', or '06/08/2026' — how the till labels the day it will ask about. */
export function formatIsoDay(iso: string, todayIso: string, yesterdayIso: string): string {
  if (iso === todayIso) return 'Hoy';
  if (iso === yesterdayIso) return 'Ayer';
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
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

/**
 * '11:02 a.m.' today, '04/08/2026' any earlier day — the *when* column of a
 * list of validations.
 *
 * Two different questions wear the same column. Under today's list the date is
 * on the header already, so the hour is the only thing that tells two rows
 * apart; on a row from last Tuesday the hour is noise — nobody reconciles a
 * receipt against 09:12, they reconcile it against the day. So the value says
 * whichever of the two is still information. The hour is the receipt's own
 * twelve-hour form, the way it is said out loud at a counter — the same
 * `formatTime` the confirmation and the printed ticket use, so one payment is
 * never two spellings of one minute.
 *
 * What it is given matters as much: this reads the moment the *counter*
 * validated, never the bank's `trnAt`. Banesco reports a pago móvil with
 * `trnTime` "00.00.00" — the movement carries a date and no time at all — so an
 * hour drawn from it was 00:00 on every row ever validated.
 */
export function formatValidatedAt(epochSeconds: number, nowSeconds: number): string {
  const today = startOfVenezuelaDay(nowSeconds);
  return epochSeconds >= today ? formatTime(epochSeconds) : formatDate(epochSeconds);
}

/**
 * A timestamp the **bank** reported: '06/08/2026 · 10:42 a.m.', or '06/08/2026'
 * alone when the bank gave no time of day.
 *
 * Banesco sends `trnDate` and `trnTime` in two fields and fills the second with
 * "00.00.00" for the movements we search, so `trnAt` is midnight of the day the
 * payment happened. Printing that as "12:00 a.m." on a receipt is a time the
 * bank never said — precision invented by the formatter — and a customer
 * reading it would take it for the minute they paid. A payment genuinely made
 * in the first minute of a day loses its hour here, which is the cheaper of the
 * two mistakes by a wide margin.
 */
export function formatBankDateTime(epochSeconds: number): string {
  const { hour, minute } = localParts(epochSeconds);
  if (hour === 0 && minute === 0) return formatDate(epochSeconds);
  return formatDateTime(epochSeconds);
}

/**
 * 'hace 3 minutos', 'hace 2 horas', or the exact date once it is older than a
 * day. The counter uses it for "ya fue cobrado": when a payment was charged
 * reads fastest as elapsed time, and is reconciled against a date only once it
 * stops being recent.
 */
export function formatRelativeTime(epochSeconds: number, nowSeconds: number): string {
  const diff = Math.max(0, nowSeconds - epochSeconds);
  if (diff < 60) return 'hace un momento';
  if (diff < 3600) {
    const minutes = Math.floor(diff / 60);
    return `hace ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
  }
  if (diff < SECONDS_PER_DAY) {
    const hours = Math.round(diff / 3600);
    return `hace ${hours} ${hours === 1 ? 'hora' : 'horas'}`;
  }
  return formatDateTime(epochSeconds);
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

/** '26/01' — a day on a chart's axis, where the year is on the heading already. */
export function shortIsoDay(iso: string): string {
  const [, month, day] = iso.split('-');
  return `${day}/${month}`;
}

/**
 * 'lunes 26/01' — a day as a person names it, for the tooltip over a column.
 *
 * The weekday is the whole point: "el martes flojo" is a thing a shopkeeper
 * knows about their week, and a bare date makes them count it out. `fromIsoDay`
 * builds the day at *local* midnight, so `getDay` reads the day the merchant
 * had, not the one UTC was having.
 */
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export function namedIsoDay(iso: string): string {
  return `${WEEKDAYS[fromIsoDay(iso).getDay()]} ${shortIsoDay(iso)}`;
}

/** '2 p.m.' — an hour of the day, the way a counter says it. */
export function formatHour(hour: number): string {
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve} ${hour < 12 ? 'a.m.' : 'p.m.'}`;
}
