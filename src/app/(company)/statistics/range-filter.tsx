'use client';

import { useRef, useState } from 'react';
/**
 * "Últimos 7 días" and the calendar beside it — the one control the whole
 * screen is answered from.
 *
 * Two halves, because a merchant asks the question two ways. Nine times out of
 * ten it is a relative span they name ("esta semana", "el mes pasado") and that
 * is a closed dropdown — the same `SearchableSelect` the panel filters a cashier
 * with, so nobody learns a second widget for the same gesture (§11). The tenth
 * time it is two specific days, and that is the calendar, in range mode.
 *
 * There is no "Personalizado" *option* on the dropdown, on purpose: choosing it
 * would open a picker, which makes picking a custom range two gestures instead
 * of one. The calendar is simply always there; using it is what makes the range
 * custom, and the dropdown then shows the two days it resolved to rather than a
 * preset that is no longer true.
 *
 * The range travels in the URL — `?range=last_30_days`, or `?from=…&to=…` — so
 * a view is shareable and survives a reload, and the page stays a Server
 * Component. Both spellings are set in one navigation (`setAll`): picking a
 * preset has to clear the two days and picking two days has to clear the preset,
 * and doing that as two calls would put a state on the URL that means neither.
 */
import type { DateRange } from 'react-day-picker';

import { Button } from '@/components/ui/button.tsx';
import { Calendar } from '@/components/ui/calendar.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx';
import type { StatsRange } from '../../../application/validations/validation-stats.ts';
import { Icon } from '../../_components/icon.tsx';
import { SearchableSelect, type SelectOption } from '../../_components/searchable-select.tsx';
import { useQueryFilter } from '../../_lib/query-filter.tsx';
import { fromIsoDay, toIsoDay, venezuelaToday } from '../../_lib/venezuela-format.ts';
import { RANGE_OPTIONS } from './ranges.ts';

export function RangeFilter({ range }: { readonly range: StatsRange }) {
  const { setAll, pending } = useQueryFilter();
  const [open, setOpen] = useState(false);

  const options: readonly SelectOption[] =
    range.preset === 'custom'
      ? [{ value: 'custom', label: customLabel(range), hint: 'Calendario' }, ...RANGE_OPTIONS]
      : RANGE_OPTIONS;

  return (
    <div className="flex items-center gap-2">
      <div className="w-[190px]">
        <SearchableSelect
          id="statistics-range"
          options={options}
          value={range.preset}
          onChange={(next) => setAll({ range: next, from: null, to: null })}
          disabled={pending}
          searchable={false}
        />
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label="Elegir un rango de fechas"
            disabled={pending}
          >
            <Icon name="calendar-blank" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <RangeCalendar
            range={range}
            onPick={(from, to) => {
              setAll({ range: null, from, to });
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * Its own component so `venezuelaToday` is read when the calendar *opens*
 * rather than once per page — a panel left open past midnight would otherwise
 * keep refusing today.
 *
 * The range already on screen is shown as selected, because opening a picker
 * that has forgotten what you are looking at is disorienting. But the **first**
 * click is always a new start, never an adjustment of that band: react-day-picker
 * would otherwise read a click as "move the near end", which turns one click into
 * a committed range the merchant did not ask for. So the first click restarts the
 * selection and the second closes it, which is the two-gesture rhythm the line
 * under the calendar promises.
 */
function RangeCalendar({
  range,
  onPick,
}: {
  readonly range: StatsRange;
  readonly onPick: (from: string, to: string) => void;
}) {
  const today = venezuelaToday();
  const [picked, setPicked] = useState<DateRange | undefined>({
    from: fromIsoDay(range.fromDay),
    to: fromIsoDay(range.toDay),
  });
  /** Whether anything in *this* opening has been clicked yet. */
  const started = useRef(false);

  return (
    <div className="flex flex-col">
      <Calendar
        mode="range"
        selected={picked}
        defaultMonth={fromIsoDay(range.fromDay)}
        disabled={{ after: fromIsoDay(today) }}
        onSelect={(next: DateRange | undefined, clicked: Date) => {
          if (!started.current) {
            started.current = true;
            setPicked({ from: clicked, to: undefined });
            return;
          }
          setPicked(next);
          // Only once both ends are down. A single click is half a question, and
          // answering it would reload the screen for one day and then again for
          // the pair.
          if (next?.from !== undefined && next.to !== undefined) {
            onPick(toIsoDay(next.from), toIsoDay(next.to));
          }
        }}
      />
      <p className="m-0 px-3 pb-3 text-center text-[11px] text-muted-foreground">
        Elige el primer día y luego el último.
      </p>
    </div>
  );
}

/** '10/01 – 12/01/2026' — what the dropdown reads once the calendar answered. */
function customLabel(range: StatsRange): string {
  const [, fromMonth, fromDay] = range.fromDay.split('-');
  const [toYear, toMonth, toDay] = range.toDay.split('-');
  return `${fromDay}/${fromMonth} – ${toDay}/${toMonth}/${toYear}`;
}
