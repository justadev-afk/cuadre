'use client';

/**
 * The counter — v2 screens 11, 12, 15, 16, 17, 26.
 *
 * The form is always on screen; every answer — the in-flight wait, the
 * confirmation, and each verdict — is a modal *over* it, the same shape the "mi
 * turno" rows re-open. So a navigation never loses a typed reference and the
 * layout never jumps: the form sits behind, and closing a verdict (or
 * "Verificar datos") returns to it exactly as it was. Only a confirmed charge
 * clears the form, because that submission is done.
 *
 * The rules that decide whether a submission is even askable are the domain's,
 * imported directly: `parseAmountToCents` refuses an amount that is not an exact
 * count of cents, `normalisePhone` refuses a number with no pago móvil behind
 * it. Re-implementing either here is how the counter and the use case start
 * disagreeing about what a valid claim is — so the Validar button is disabled
 * until they all pass, and a field that is typed-but-wrong turns its border red.
 *
 * Five fields, all required, because they are exactly what a pago móvil search
 * takes (Banesco, 2026-08-11): the last digits of the reference, the payer's
 * phone, their bank, the amount and the **day it was paid**. How many digits of
 * the reference is the receiving bank's own answer — `referenceDigits` — so
 * nothing here says "six".
 */
import { useEffect, useId, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Calendar } from '@/components/ui/calendar.tsx';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs.tsx';
import { cn } from '@/lib/utils.ts';
import type { BankPaymentKind, PaymentKind } from '../../../application/ports/bank-gateway.ts';
import { formatBolivares, parseAmountToCents } from '../../../domain/money.ts';
import { formatPhoneForDisplay, normalisePhone } from '../../../domain/phone.ts';
import { findBank, SUDEBAN_BANKS } from '../../../domain/sudeban.ts';
import { ContentLayout } from '../../_components/content-layout.tsx';
import { Icon } from '../../_components/icon.tsx';
import { PaymentKindMark } from '../../_components/payment-kind-mark.tsx';
import { SearchableSelect, type SelectOption } from '../../_components/searchable-select.tsx';
import { BankSpinner, ButtonSpinner } from '../../_components/skeleton.tsx';
import { type ReceiptData, ThermalReceipt } from '../../_components/thermal-receipt.tsx';
import { ValidatedPaymentModal } from '../../_components/validated-payment-modal.tsx';
import { bankAccountLabel } from '../../_lib/bank-account-label.ts';
import { API } from '../../_lib/endpoints.ts';
import { maskCurrency, maskDate, readTypedDate } from '../../_lib/masks.ts';
import { kindLabel } from '../../_lib/payment-kind.ts';
import { postJson } from '../../_lib/use-endpoint-action.ts';
import { useMaskedInput } from '../../_lib/use-masked-input.ts';
import {
  formatBankDateTime,
  formatClock,
  formatDateTime,
  formatIsoDay,
  formatRelativeTime,
  formatSeconds,
  fromIsoDay,
  toIsoDay,
  venezuelaToday,
  yesterdayInVenezuela,
} from '../../_lib/venezuela-format.ts';

import type { ChargeOutcome, ConfirmedCharge, ReceivingAccountView } from './charge-types.ts';

/** A confirmed charge as the thermal receipt states it. */
function chargeReceipt(
  charge: ConfirmedCharge,
  extra?: {
    bankName?: string;
    merchantName?: string;
    merchantRif?: string;
    cashierName?: string;
  },
): ReceiptData {
  return {
    merchantName: extra?.merchantName,
    merchantRif: extra?.merchantRif,
    controlCode: charge.controlCode,
    kind: charge.kind,
    reference: charge.reference,
    amountCents: charge.amountCents,
    payerPhone: charge.payerPhone,
    bankName: extra?.bankName,
    cashierName: extra?.cashierName,
    paidAt: charge.paidAt,
    atSeconds: charge.createdAt,
    isSandbox: charge.isSandbox,
  };
}

/**
 * One row of the "mi turno" list — a full charge, so a click can re-open it.
 * Exactly a `ConfirmedCharge`: it used to add the payer's bank, which the
 * confirmation now carries too, because both surfaces name both banks.
 */
export type RecentCharge = ConfirmedCharge;

/** One connected bank, as the counter's "banco receptor" dropdown shows it. */
export type CheckoutAccount = {
  readonly id: string;
  /** 'Banesco'. */
  readonly bankName: string;
  /** What the merchant named this connection, when they named it. */
  readonly label: string | null;
  readonly isSandbox: boolean;
  /**
   * What this bank can be asked about and what each kind takes. The selector
   * beside "Validar pago" is this list, and every field below it — which ones
   * appear, how long the reference is, what is required — is read off the chosen
   * entry. Nothing on this screen decides any of it.
   */
  readonly paymentKinds: readonly BankPaymentKind[];
  /**
   * The accounts this connection receives transferencias in, already resolved on
   * the server. Empty means the merchant registered none, and the Transferencia
   * tab says this bank cannot take them here.
   */
  readonly receivingAccounts: readonly ReceivingAccountView[];
};

type CheckoutFormProps = {
  /** Every connected bank. The cashier picks which one receives. */
  accounts: readonly CheckoutAccount[];
  /** The last few charges on this till, for the right pane. */
  recent: readonly RecentCharge[];
  turnoCount: number;
  turnoCents: number;
  /** Printed on the receipt — the shop and who is at the till. */
  merchantName?: string;
  /** And their RIF, printed under the name. */
  merchantRif?: string;
  cashierName?: string;
  /** The sidebar-less express till: fill the height and drop the "ver todas" exit. */
  express?: boolean;
  /**
   * The four-hour shift prompt is up (a blocking, full-screen gate rendered by
   * the layout). While it is, the till must not also raise its own modal — the
   * shift dialog is the single overlay on screen. The in-flight `busy`/`outcome`
   * state is kept, so acknowledging the prompt reveals the same result again.
   */
  shiftDue?: boolean;
};

/** The Venezuelan banks, shaped once for the searchable dropdown. */
const BANK_OPTIONS: readonly SelectOption[] = SUDEBAN_BANKS.map((bank) => ({
  value: bank.code,
  label: bank.name,
  hint: bank.code,
}));

/** Where the last-chosen payer bank is remembered between charges. */
const LAST_BANK_KEY = 'cuadre.last-bank';

/**
 * The bounds on a whole reference, matching the use case's. Wide on purpose:
 * Banesco's run 11 and 12 digits and other banks will differ, so the field only
 * refuses what nobody could have read off a receipt.
 */
const MIN_FULL_REFERENCE = 6;
const MAX_FULL_REFERENCE = 20;

// Shared Nocturne shapes as utility strings.
const BOX_LG = 'flex flex-col gap-3.5 rounded-xl border border-border bg-card p-[26px]';
const BOX_QUIET = 'flex flex-col gap-3.5 rounded-xl border border-border bg-sidebar px-[22px] py-5';
const KICKER = 'text-[10px] font-normal tracking-[0.1em] text-muted-foreground uppercase';
const MARK_OK =
  'grid size-[52px] shrink-0 place-items-center rounded-full border border-primary bg-primary/[0.14] text-2xl text-primary';
const MARK_QUIET =
  'grid size-[52px] shrink-0 place-items-center rounded-full border border-[var(--color-neutral-500)] bg-foreground/[0.07] text-2xl text-[var(--color-neutral-300)]';
// Label pinned top-left (default text-align), the number centred under it.
const STAT_CARD =
  'flex min-h-[76px] flex-col justify-center gap-0.5 rounded-md bg-card px-2.5 py-3.5 shadow-[var(--shadow-sm)]';
// The inset-fade hairline under a "mi turno" row — the table's row rule, on a
// button. The row is a plain 100% of the list it sits in; what makes its hover
// bleed past the text is the list being wider than the pane, not the row being
// wider than the list.
const RECENT_ROW =
  'flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-[9px] text-left transition-colors hover:bg-foreground/[0.06] bg-[linear-gradient(to_right,transparent,color-mix(in_srgb,var(--color-text)_8%,transparent)_20px,color-mix(in_srgb,var(--color-text)_8%,transparent)_calc(100%-20px),transparent)] bg-[length:100%_1px] bg-bottom bg-no-repeat';
// So the 10px of bleed on each side is the scroller's: a negative margin does
// not widen a box, it *slides* it, and the width has to grow by both margins for
// the highlight to sit evenly around the row it belongs to.
//
// It has to be the scroller and not the rows, because a row wider than its
// scroll box is content overflowing sideways — and `overflow-y-auto` computes
// overflow-x to `auto` as well, so six rows of identical width still put a
// horizontal scrollbar under the list. Widening the box draws exactly the same
// thing with nothing to scroll.
const RECENT_SCROLLER =
  'flex min-h-0 w-[calc(100%+1.25rem)] flex-1 -mx-2.5 flex-col overflow-y-auto';
const MODAL_CLASS = 'w-[min(440px,calc(100%-2rem))]';

/**
 * The phone, formatted only as much as it is typed — digits with a hyphen after
 * the trunk, and nothing forced. Typing `0` shows `0`, not `04`: the field
 * never invents a prefix the cashier did not type. `normalisePhone` is the
 * authority, so a wrong number just turns the border red.
 */
function formatPhoneLoose(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 11);
  return digits.length <= 4 ? digits : `${digits.slice(0, 4)}-${digits.slice(4)}`;
}

/** "Banesco · Caja principal" for the bank a charge landed on, or undefined. */
function accountLabel(
  accounts: readonly CheckoutAccount[],
  bankAccountId: string,
): string | undefined {
  const account = accounts.find((a) => a.id === bankAccountId);
  if (account === undefined) return undefined;
  return bankAccountLabel(account.bankName, account.label);
}

/**
 * The modal's border, by tone: accent for a confirmation, the danger token for
 * a refusal the cashier cannot fix here (already-charged, rejected, the bank
 * unavailable), neutral for the wait and for "todavía no aparece" — which is an
 * answer to retry, not an error.
 */
function modalBorderTone(busy: boolean, outcome: ChargeOutcome | null): string {
  if (busy || outcome === null) return '';
  if (outcome.status === 'confirmed') return 'border-primary/40';
  if (outcome.status === 'not_found') return '';
  return 'border-[color-mix(in_srgb,var(--color-danger)_55%,transparent)]';
}

export function CheckoutForm({
  accounts,
  recent,
  turnoCount,
  turnoCents,
  merchantName,
  merchantRif,
  cashierName,
  express = false,
  shiftDue = false,
}: CheckoutFormProps) {
  const referenceId = useId();
  const phoneId = useId();
  const bankId = useId();
  const amountId = useId();
  const dateId = useId();
  const accountSelectId = useId();
  const receivingId = useId();

  /** Which form is on screen. Pago móvil is the common case, so it opens. */
  const [kind, setKind] = useState<PaymentKind>('pago_movil');
  const [reference, setReference] = useState('');
  const [phone, setPhone] = useState('');
  /**
   * The phone is the one field on this form that is rewritten as it is typed,
   * so it is the one that has to carry its caret across the rewrite: a cashier
   * reading a number off a customer's screen corrects a digit in the middle of
   * it about as often as they type it straight through.
   */
  const phoneField = useMaskedInput(formatPhoneLoose, (next) => {
    setPhone(next);
    edited();
  });
  /** The transferencia's receiving account — one of the connection's own. */
  const [receivingAccount, setReceivingAccount] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [amount, setAmount] = useState('');
  /**
   * The day the customer paid, or `null` for "hoy". Null rather than today's
   * date, so a till left open overnight still means *today* in the morning
   * instead of silently asking the bank about yesterday. Resolved at submit.
   */
  const [paymentDate, setPaymentDate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ChargeOutcome | null>(null);
  const [copied, setCopied] = useState(false);
  /** A past charge the cashier tapped in "mi turno", shown read-only in a modal. */
  const [viewing, setViewing] = useState<RecentCharge | null>(null);

  // Which connected bank receives. Always one, defaulting to the first the
  // server listed (production before sandbox, most recently verified first).
  const [accountId, setAccountId] = useState<string>(accounts[0]?.id ?? '');
  const selectedAccount = accounts.find((a) => a.id === accountId) ?? accounts[0] ?? null;

  // Everything about the shape of this form is the bank's answer, not this
  // screen's: which fields exist, how many digits the reference takes, whether a
  // phone or an account is required. A bank that offers one kind renders no
  // selector at all.
  const kinds = selectedAccount?.paymentKinds ?? [];
  const spec = kinds.find((candidate) => candidate.kind === kind) ?? kinds[0] ?? null;
  /**
   * How the reference field behaves for the chosen kind. `null` digits means the
   * bank wants the whole reference — the number the customer's receipt shows —
   * so the field stops counting and only asks that it look like a reference.
   */
  const referenceDigits = spec?.referenceDigits ?? null;
  const wholeReference = referenceDigits === null;
  const receivable = selectedAccount?.receivingAccounts ?? [];
  /** Which kinds ask which account the money landed in — a transferencia does. */
  const needsAccount = spec?.needsReceivingAccount === true;
  /** A transferencia needs an account, and this bank has none registered. */
  const transferBlocked = needsAccount && receivable.length === 0;

  /**
   * One key per *submission*, not per request: a retry of the same typed data
   * carries the same key, so a payment that lands between two attempts is
   * charged once and reads back with the same control code. Editing any field
   * makes it a different submission and clears it.
   */
  const idempotencyKey = useRef<string | null>(null);
  /** Which attempt the screen is waiting for. *Cancelar* just stops caring. */
  const attempt = useRef(0);

  // The payer's bank is the one field a cashier picks rather than reads, and it
  // repeats all shift: a bakery beside a Banesco branch sees the same bank all
  // day. Preselecting the last pick saves the search on the common case.
  useEffect(() => {
    const last = localStorage.getItem(LAST_BANK_KEY);
    if (last !== null && findBank(last) !== null) setBankCode(last);
  }, []);

  // The reference is the first thing typed, so focus it whenever the form is the
  // thing on screen — on load, after a modal closes, and after a tab change —
  // without reaching for the mouse. It has to be an effect rather than a line in
  // the tab handler: the click that changes the tab focuses the trigger itself,
  // so a `focus()` called inside `onValueChange` is undone a moment later and the
  // next keystrokes land nowhere.
  const referenceRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (spec === null || busy || outcome !== null) return;
    // On the next frame, not now: the tab strip is a Radix roving-focus group
    // that pulls the focus onto the clicked trigger from an effect of its own,
    // and whichever of the two runs last wins. A frame later is after both.
    const frame = requestAnimationFrame(() => referenceRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [busy, outcome, spec]);

  const bank = findBank(bankCode);
  const amountCents = parseAmountToCents(amount);

  // ── realtime validity — the Validar button reads these, and each typed-but-
  //    wrong field turns red. Empty is never red: a field you have not filled is
  //    not a field you got wrong.
  const refValid = wholeReference
    ? reference.length >= MIN_FULL_REFERENCE && reference.length <= MAX_FULL_REFERENCE
    : reference.length === referenceDigits;
  // Each of these is only asked about when the kind says it exists, so a phone
  // left over from the other tab never gates — or reaches — a transferencia.
  const phoneValid = spec?.needsPayerPhone !== true || normalisePhone(phone) !== null;
  const accountValid = spec?.needsReceivingAccount !== true || receivingAccount !== '';
  const bankValid = bank !== null;
  const amountValid = amountCents !== null && amountCents > 0;
  const canSubmit =
    spec !== null &&
    refValid &&
    phoneValid &&
    accountValid &&
    bankValid &&
    amountValid &&
    accountId !== '';

  const refInvalid = reference !== '' && !refValid;
  const phoneInvalid = spec?.needsPayerPhone === true && phone.trim() !== '' && !phoneValid;
  const amountInvalid = amount !== '' && !amountValid;

  function edited(): void {
    idempotencyKey.current = null;
  }

  function chooseBank(code: string): void {
    setBankCode(code);
    if (code !== '') localStorage.setItem(LAST_BANK_KEY, code);
    edited();
  }

  /**
   * Clears the per-charge fields. The payer's bank stays — it repeats all shift
   * — and so does the date: a cashier working through last night's payments
   * would otherwise reset to today on every single one.
   */
  function clearFields(): void {
    idempotencyKey.current = null;
    setReference('');
    setPhone('');
    setAmount('');
  }

  /**
   * Switching tabs empties the fields rather than carrying them across.
   *
   * The two kinds are two claims about two different payments, and a reference
   * typed for one is not a head start on the other — but more than that, a value
   * left behind can *reach the bank*, and Banesco is unforgiving about a field
   * that should not have been there. The use case drops what the kind does not
   * take, and this makes sure the screen never shows it either.
   */
  function chooseKind(next: PaymentKind): void {
    if (next === kind) return;
    setKind(next);
    clearFields();
    setReceivingAccount('');
    setPaymentDate(null);
    // The focus goes back to the reference, but from the effect above: switching
    // tabs is the start of a new charge, and a till is worked with two hands and
    // no mouse — leaving the focus on the tab strip costs a reach for the mouse
    // on every claim.
  }

  async function send(): Promise<void> {
    const cents = parseAmountToCents(amount);
    const payerPhone = spec?.needsPayerPhone === true ? normalisePhone(phone) : null;
    // The button gates this, but Enter can still fire a form: the same rules,
    // once more, silently — a disabled path, not an error message.
    if (spec === null || !refValid || bank === null || cents === null) return;
    if (spec.needsPayerPhone && payerPhone === null) return;
    if (spec.needsReceivingAccount && receivingAccount === '') return;
    if (accountId === '') return;

    const key = idempotencyKey.current ?? crypto.randomUUID();
    idempotencyKey.current = key;

    const mine = attempt.current + 1;
    attempt.current = mine;
    setOutcome(null);
    setBusy(true);

    const answer = await postJson<ChargeOutcome>(API.charge, {
      kind: spec.kind,
      reference,
      payerPhone,
      // Only ever sent for a kind that takes one: what a kind does not declare
      // must not reach the wire, and a stale value left on the form by a cashier
      // switching tabs is exactly how it would.
      receivingAccount: spec.needsReceivingAccount ? receivingAccount : null,
      sourceBankId: bank.code,
      amountCents: cents,
      // Resolved here rather than held in state: "hoy" has to mean the day this
      // is being sent, not the day the page was opened.
      paymentDate: spec.needsDate ? (paymentDate ?? venezuelaToday()) : null,
      idempotencyKey: key,
      bankAccountId: accountId,
      // A request that never arrives reads exactly like a bank we could not
      // reach, which is the one thing it certainly means to the cashier. The
      // idempotency key is unchanged, so *Reintentar* is the same charge.
    }).catch<ChargeOutcome>(() => ({ status: 'failed', failure: 'unavailable' }));

    // A cancelled attempt is not an answer anybody is waiting for any more.
    if (attempt.current !== mine) return;
    setBusy(false);
    setOutcome(answer);
    // A confirmed charge is done: empty the form behind the modal so closing it
    // reveals a fresh counter. A verdict keeps the data — the cashier will edit
    // and retry it.
    if (answer.status === 'confirmed') clearFields();
  }

  /** "Nuevo cobro": reset the form and dismiss the modal. */
  function newCharge(): void {
    attempt.current += 1;
    clearFields();
    setOutcome(null);
    setBusy(false);
    setCopied(false);
  }

  /** Dismiss the modal, leaving the form as it is — cancel, close, or edit. */
  function backToForm(): void {
    attempt.current += 1;
    setOutcome(null);
    setBusy(false);
  }

  const aside = (
    <MiTurno
      recent={recent}
      turnoCount={turnoCount}
      turnoCents={turnoCents}
      onOpen={(charge) => setViewing(charge)}
      express={express}
    />
  );

  return (
    <ContentLayout
      title="Validar pago"
      aside={aside}
      asideTitle="Mi turno"
      fill={express}
      actions={
        // Rendered from the bank's own list, so a bank that only answers about
        // pago móvil shows no selector at all rather than a tab that refuses.
        kinds.length > 1 ? (
          <Tabs value={kind} onValueChange={(next) => chooseKind(next as PaymentKind)}>
            <TabsList>
              {kinds.map((candidate) => (
                <TabsTrigger key={candidate.kind} value={candidate.kind} disabled={busy}>
                  {candidate.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        ) : undefined
      }
    >
      <form
        className={cn(BOX_LG, express && 'h-full')}
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        {/* First, because it decides the rest: which bank receives is what says
            how many digits of the reference the field below even takes. A
            transferencia also has to say *into which account*, and the two are
            one answer — where the money landed — so they share the row. */}
        <div className={cn('grid gap-3', needsAccount ? 'grid-cols-2' : 'grid-cols-1')}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={accountSelectId}>Banco receptor</Label>
            <SearchableSelect
              id={accountSelectId}
              options={accounts.map((account) => ({
                value: account.id,
                label: bankAccountLabel(account.bankName, account.label),
                hint: account.isSandbox ? 'sandbox' : undefined,
              }))}
              value={accountId}
              onChange={(value) => {
                setAccountId(value);
                edited();
              }}
              searchPlaceholder="Buscar banco…"
            />
          </div>

          {needsAccount && (
            <div className="flex flex-col gap-1.5">
              {/* Just "Cuenta": it sits beside the bank that owns it, and the
                  merchant's own account is the only one this form asks for. */}
              <Label htmlFor={receivingId}>Cuenta</Label>
              <SearchableSelect
                id={receivingId}
                options={receivable.map((account) => ({
                  value: account.number,
                  label: account.masked,
                }))}
                value={receivingAccount}
                onChange={(value) => {
                  setReceivingAccount(value);
                  edited();
                }}
                placeholder={transferBlocked ? 'Sin cuentas registradas' : 'Elige la cuenta'}
                searchPlaceholder="Buscar cuenta…"
                disabled={transferBlocked}
              />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={referenceId}>
            {wholeReference
              ? 'Referencia completa'
              : `Últimos ${referenceDigits} dígitos de la referencia`}
          </Label>
          <Input
            ref={referenceRef}
            id={referenceId}
            aria-invalid={refInvalid}
            disabled={transferBlocked}
            className="h-[66px] text-center text-[30px] tracking-[0.16em] tabular-nums max-[899px]:h-[58px] max-[899px]:text-[26px]"
            value={reference}
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            maxLength={wholeReference ? MAX_FULL_REFERENCE : referenceDigits}
            placeholder={'0'.repeat(wholeReference ? 11 : referenceDigits)}
            onChange={(event) => {
              const digits = event.target.value.replace(/\D/g, '');
              // Where the bank wants a tail, pasting the whole reference keeps
              // its end rather than being refused — the tail is the question
              // either way. Where it wants the whole thing, nothing is trimmed.
              setReference(
                wholeReference
                  ? digits.slice(0, MAX_FULL_REFERENCE)
                  : digits.slice(-referenceDigits),
              );
              edited();
            }}
          />
        </div>

        {/* A pago móvil is made from a phone, so it asks for one beside the
            payer's bank; a transferencia asked for its account up top, and the
            bank is left alone on the row. */}
        <div className={cn('grid gap-3', spec?.needsPayerPhone ? 'grid-cols-2' : 'grid-cols-1')}>
          {spec?.needsPayerPhone && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={phoneId}>Teléfono del pagador</Label>
              <Input
                {...phoneField}
                id={phoneId}
                aria-invalid={phoneInvalid}
                disabled={transferBlocked}
                value={phone}
                inputMode="tel"
                autoComplete="off"
                // No `maxLength`: the mask already caps the number at its eleven
                // digits, and a character count beside it is the same rule
                // written twice — one that measures the hyphen too, and that
                // freezes the field the moment it is full. A cashier who spots
                // a missing digit halfway through a complete number could then
                // type nothing at all, which is exactly what "no me deja
                // editar" looks like.
                placeholder="0414-3125566"
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={bankId}>Banco emisor</Label>
            <SearchableSelect
              id={bankId}
              options={BANK_OPTIONS}
              value={bankCode}
              onChange={chooseBank}
              placeholder="Elige el banco"
              searchPlaceholder="Buscar banco…"
              disabled={transferBlocked}
            />
          </div>
        </div>

        {/* The amount shares its row with the date wherever the kind takes one —
            both do, at Banesco — and takes the full width otherwise, since a
            half-width amount beside nothing reads as a field that lost its
            neighbour. */}
        <div className={cn('grid gap-3', spec?.needsDate ? 'grid-cols-2' : 'grid-cols-1')}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={amountId}>Monto del cobro</Label>
            <div
              className={cn(
                'flex h-[52px] items-center rounded-md border border-input bg-card px-3 transition-colors focus-within:border-primary',
                amountInvalid && 'border-destructive focus-within:border-destructive',
              )}
            >
              <span className="mr-2 font-heading text-muted-foreground">Bs</span>
              <input
                id={amountId}
                className="min-w-0 flex-1 border-none bg-transparent p-0 text-right font-heading text-[22px] tabular-nums text-foreground caret-primary outline-none disabled:cursor-not-allowed"
                value={amount}
                disabled={transferBlocked}
                inputMode="numeric"
                autoComplete="off"
                placeholder="0,00"
                onChange={(event) => {
                  setAmount(maskCurrency(event.target.value));
                  edited();
                }}
              />
            </div>
          </div>

          {/* Only where the kind takes a date — and this is not decoration: the
              bank searches a single day, so a customer who paid last night and
              turns up this morning is findable only because the cashier can move
              it back. A transferencia asks for it too, even though the day
              reaches the bank on only one of its two modalities: which one it is
              depends on the customer's bank, and "¿fue interbancaria?" is not a
              question to put to someone with a queue in front of them. */}
          {spec?.needsDate ? (
            <PaymentDateField
              id={dateId}
              value={paymentDate}
              onChange={(next) => {
                setPaymentDate(next);
                edited();
              }}
            />
          ) : null}
        </div>

        {/* Loud, because every field above it is dead: a quiet grey line under a
            form that silently refuses to be typed into reads as a bug. The
            danger token is the one red in the palette. */}
        {transferBlocked && (
          <p className="m-0 flex items-start gap-2 rounded-md border border-destructive bg-destructive/[0.12] px-3 py-2.5 text-[13px] text-destructive">
            <Icon name="warning-circle" className="mt-0.5 shrink-0" />
            <span>
              {selectedAccount?.bankName ?? 'Este banco'} no acepta transferencias en esta caja: no
              tiene ninguna cuenta receptora registrada. Se agregan en Bancos.
            </span>
          </p>
        )}

        {/* Last, and pinned to the floor of the card: the till fills the window,
            so anywhere else leaves the dead space the cashier's thumb is aimed
            at. `mt-auto` is inert on a card that is only as tall as its fields.

            The arrow becomes a spinner for exactly as long as the bank is being
            asked. The modal says the same thing, but the button is what was just
            tapped and it is what the eye is still on — and when the shift prompt
            suppresses the modal, it is the only answer there is. */}
        <Button type="submit" className="mt-auto h-[50px] text-base" disabled={!canSubmit || busy}>
          Validar
          {busy ? <ButtonSpinner /> : <Icon name="arrow-right" />}
        </Button>
      </form>

      {!shiftDue && (busy || outcome !== null) && (
        <ChargeModal
          busy={busy}
          outcome={outcome}
          reference={reference}
          amountCents={amountCents}
          accounts={accounts}
          copied={copied}
          onCopy={async (code) => {
            await navigator.clipboard.writeText(code);
            setCopied(true);
          }}
          onCancel={backToForm}
          onNewCharge={newCharge}
          onRetry={() => void send()}
          onEdit={backToForm}
          merchantName={merchantName}
          merchantRif={merchantRif}
          cashierName={cashierName}
        />
      )}

      {!shiftDue && viewing !== null && (
        <ValidatedModal
          charge={viewing}
          accounts={accounts}
          merchantName={merchantName}
          merchantRif={merchantRif}
          cashierName={cashierName}
          onClose={() => setViewing(null)}
        />
      )}
    </ContentLayout>
  );
}

/**
 * The day the customer paid — **typed or picked**, both in one control.
 *
 * A calendar alone is one tap for yesterday and four for last month; typing
 * alone is eight keystrokes for today. So the field is an input the cashier can
 * type `10/07` or `10/07/2026` into, with the calendar on the button beside it
 * for the days that are easier to point at than to spell. `maskDate` formats as
 * you type and `readTypedDate` is the authority on what it means, exactly as the
 * amount and phone fields already work.
 *
 * Future days are refused because a payment cannot have happened tomorrow — the
 * same rule the use case enforces, so the field never offers a submission the
 * server will turn away. A half-typed date is not wrong yet, so it only turns
 * the border red once it is complete and still impossible.
 *
 * **"Hoy" is `null`, not a date**, and that is the whole design of this field. A
 * till is left open all night; a date resolved when the page rendered would
 * still say "Hoy" at 8am and quietly ask the bank about yesterday, which reads
 * as a bug and is one. Holding "unset" instead means the day is worked out at
 * the moment of asking, so "Hoy" is true whenever it is read. Typing or picking
 * today sets it back to `null` for the same reason: a cashier who writes today's
 * date means today.
 */
function PaymentDateField({
  id,
  value,
  onChange,
}: {
  id: string;
  /** `null` is "hoy, whatever hoy turns out to be". */
  value: string | null;
  onChange: (iso: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  /**
   * What is in the box while it is being typed. `null` means "show the value",
   * so the field reads "Hoy" or `10/07/2026` until a keystroke takes it over and
   * blur hands it back.
   */
  const [typing, setTyping] = useState<string | null>(null);

  const shown =
    typing ??
    (value === null ? 'Hoy' : formatIsoDay(value, venezuelaToday(), yesterdayInVenezuela()));
  // Only judged once the day, month and year are all there: a date half typed is
  // not a date typed wrong.
  const typedInvalid =
    typing !== null && typing.length === 10 && readTypedDate(typing, venezuelaToday()) === null;

  /** Commits what was typed, or reverts to the value when it means nothing. */
  const commit = (): void => {
    if (typing === null) return;
    const today = venezuelaToday();
    const iso = readTypedDate(typing, today);
    if (iso !== null) onChange(iso === today ? null : iso);
    setTyping(null);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>Fecha del pago</Label>
      <div
        className={cn(
          'flex h-[52px] items-center rounded-md border border-input bg-card pl-3 transition-colors focus-within:border-primary',
          typedInvalid && 'border-destructive focus-within:border-destructive',
        )}
      >
        <input
          id={id}
          className="min-w-0 flex-1 border-none bg-transparent p-0 font-heading text-[15px] tabular-nums text-foreground caret-primary outline-none"
          value={shown}
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          maxLength={10}
          aria-invalid={typedInvalid}
          onChange={(event) => setTyping(maskDate(event.target.value))}
          // Typing over "Hoy" should replace it, not append to it.
          onFocus={(event) => event.target.select()}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            // Enter belongs to the form — it sends the charge — so commit the
            // date first and let it through, rather than swallowing the key.
            commit();
          }}
        />
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mr-1 shrink-0 text-muted-foreground hover:text-primary"
              aria-label="Elegir la fecha en el calendario"
            >
              <Icon name="calendar-blank" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <CalendarBody
              value={value}
              onChange={(next) => {
                setTyping(null);
                onChange(next);
              }}
              onDone={() => setOpen(false)}
            />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

/**
 * Split out because Radix only mounts a popover's children while it is open —
 * which is what keeps `venezuelaToday()` off the server render, and what makes
 * "today" fresh every time the calendar is opened rather than once per page.
 */
function CalendarBody({
  value,
  onChange,
  onDone,
}: {
  value: string | null;
  onChange: (iso: string | null) => void;
  onDone: () => void;
}) {
  const today = venezuelaToday();
  const selected = fromIsoDay(value ?? today);

  return (
    <Calendar
      mode="single"
      required
      selected={selected}
      defaultMonth={selected}
      disabled={{ after: fromIsoDay(today) }}
      onSelect={(next: Date) => {
        const iso = toIsoDay(next);
        // Today goes back to "unset" so it keeps following the clock.
        onChange(iso === today ? null : iso);
        onDone();
      }}
    />
  );
}

// ── the right aside: "mi turno" ─────────────────────────────────────────────
function MiTurno({
  recent,
  turnoCount,
  turnoCents,
  onOpen,
  express = false,
}: {
  recent: readonly RecentCharge[];
  turnoCount: number;
  turnoCents: number;
  onOpen: (charge: RecentCharge) => void;
  /**
   * The express till is a one-way door — the cashier's only *exit* is logout —
   * so its link to `/my-validations` opens a new tab (the full, searchable list
   * in a browser tab) rather than navigating the till away. The shell till
   * links in place, since it can come back.
   */
  express?: boolean;
}) {
  return (
    <section className={cn(BOX_QUIET, 'h-full')}>
      {/* Cobrado gets the wider column — a bolívar total runs into the millions,
          Validados is a small count — and both stack centred, kicker over value. */}
      <div className="grid grid-cols-[0.7fr_1.3fr] gap-2.5">
        <div className={STAT_CARD}>
          <span className={KICKER}>Validados</span>
          <span className="text-center font-heading text-[22px]">{turnoCount}</span>
        </div>
        <div className={STAT_CARD}>
          <span className={KICKER}>Cobrado</span>
          <span className="whitespace-nowrap text-center font-heading text-[19px] tabular-nums">
            {formatBolivares(turnoCents)}
          </span>
        </div>
      </div>

      <span className={cn(KICKER, 'mt-1')}>Últimos cobros</span>
      {recent.length === 0 ? (
        <span className="text-xs text-muted-foreground">
          Todavía no validas nada en este turno.
        </span>
      ) : (
        // The one scrollable region: many cobros scroll here, inside the box,
        // never the whole till. flex-1 + min-h-0 lets it take the leftover height
        // and clip its own overflow.
        <div className={RECENT_SCROLLER}>
          {recent.map((row) => (
            <button
              type="button"
              className={RECENT_ROW}
              key={row.controlCode}
              onClick={() => onOpen(row)}
              title="Ver este cobro"
            >
              <div className="min-w-0 flex-1 text-left">
                <div className="flex items-center gap-1.5">
                  <PaymentKindMark kind={row.kind} payerPhone={row.payerPhone} />
                  <span className="font-heading text-[15px] tabular-nums">
                    {formatBolivares(row.amountCents)}
                  </span>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  {formatClock(row.createdAt)} · ref {row.reference} ·{' '}
                  {findBank(row.sourceBankId)?.name ?? row.sourceBankId}
                </span>
              </div>
              <span className="text-xs tabular-nums text-[var(--color-accent-300)]">
                {row.controlCode}
              </span>
            </button>
          ))}
        </div>
      )}

      {express ? (
        <a
          href="/my-validations"
          target="_blank"
          rel="noopener"
          className="mt-auto inline-flex items-center gap-1.5 text-xs"
        >
          Mis validaciones
          <Icon name="arrow-square-out" />
        </a>
      ) : (
        <a href="/my-validations" className="mt-auto text-xs">
          Ver todas mis validaciones
        </a>
      )}
    </section>
  );
}

/**
 * Enter runs `action` while `active`, listened for on the document rather than
 * left to whichever button holds focus.
 *
 * It has to be the document, because an answer replaces the wait *inside* an
 * already-open dialog: the button that had focus a moment earlier — the wait's
 * "Cancelar" — is unmounted with it, and a focused element removed from the DOM
 * leaves focus on `<body>`, outside the dialog. There, no native activation
 * happens and no handler bound to the dialog is ever reached, which is exactly
 * why "Pago confirmado" and "No coincide con el movimiento" both sat there
 * ignoring the key.
 *
 * A control that *does* have focus still answers for itself: Enter on "Recibo"
 * prints, on "Reintentar" retries. So the listener stands aside whenever the key
 * landed on something Enter already means something to, and nothing fires twice.
 */
function useEnterDismisses(active: boolean, action: () => void): void {
  const latest = useRef(action);
  useEffect(() => {
    latest.current = action;
  });

  useEffect(() => {
    if (!active) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Enter' || event.defaultPrevented || event.isComposing) return;
      // An Enter still held down from sending the charge is not an answer to
      // the answer: auto-repeat would dismiss it in the instant it appeared.
      if (event.repeat) return;
      const target = event.target;
      if (target instanceof Element && target.closest('a, button, input, select, textarea')) return;
      event.preventDefault();
      latest.current();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [active]);
}

// ── the answer, as a modal over the form ────────────────────────────────────
function ChargeModal({
  busy,
  outcome,
  reference,
  amountCents,
  accounts,
  copied,
  onCopy,
  onCancel,
  onNewCharge,
  onRetry,
  onEdit,
  merchantName,
  merchantRif,
  cashierName,
}: {
  busy: boolean;
  outcome: ChargeOutcome | null;
  reference: string;
  amountCents: number | null;
  accounts: readonly CheckoutAccount[];
  copied: boolean;
  onCopy: (code: string) => void | Promise<void>;
  onCancel: () => void;
  onNewCharge: () => void;
  onRetry: () => void;
  onEdit: () => void;
  merchantName?: string;
  merchantRif?: string;
  cashierName?: string;
}) {
  // Enter closes an answer, with the action that answer already marks as its
  // primary one: "Nuevo cobro" on a confirmation, "Verificar datos" on a
  // verdict. A till is worked with two hands and no mouse, so the key that sent
  // the charge is the key that clears its answer.
  useEnterDismisses(
    !busy && outcome !== null,
    outcome?.status === 'confirmed' ? onNewCharge : onEdit,
  );

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        // Dismissing mid-wait cancels; dismissing a result is the same as
        // "Verificar datos" — the form behind is left exactly as it was (and a
        // confirmed charge has already emptied it).
        if (!next) (busy ? onCancel : onEdit)();
      }}
    >
      <DialogContent
        className={cn(MODAL_CLASS, modalBorderTone(busy, outcome))}
        aria-describedby={undefined}
        showCloseButton={!busy}
      >
        {busy || outcome === null ? (
          <WaitingContent reference={reference} amountCents={amountCents} onCancel={onCancel} />
        ) : outcome.status === 'confirmed' ? (
          <ConfirmedContent
            charge={outcome.charge}
            accounts={accounts}
            copied={copied}
            onCopy={onCopy}
            onNewCharge={onNewCharge}
            merchantName={merchantName}
            merchantRif={merchantRif}
            cashierName={cashierName}
          />
        ) : (
          <VerdictContent
            outcome={outcome}
            reference={reference}
            amountCents={amountCents}
            onRetry={onRetry}
            onNewCharge={onNewCharge}
            onEdit={onEdit}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── the bank is answering ───────────────────────────────────────────────────
function WaitingContent({
  reference,
  amountCents,
  onCancel,
}: {
  reference: string;
  amountCents: number | null;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3.5 text-center">
      <BankSpinner />
      <DialogTitle className="text-[19px]">Validando el pago</DialogTitle>
      <span className="text-xs tabular-nums text-muted-foreground">
        Ref. {reference}
        {amountCents === null ? '' : ` · ${formatBolivares(amountCents)}`}
      </span>
      <div className="flex w-full flex-col gap-2.5">
        <Skeleton className="h-[11px] w-4/5" />
        <Skeleton className="h-[11px] w-[55%]" />
      </div>
      {/* Cancelling stops the screen from waiting, not the payment from being
          confirmed: the idempotency key survives, so resubmitting the same data
          returns that same charge rather than making a second one. */}
      <Button variant="secondary" size="block" onClick={onCancel}>
        Cancelar
      </Button>
    </div>
  );
}

// ── the bank confirmed ──────────────────────────────────────────────────────
function ConfirmedContent({
  charge,
  accounts,
  copied,
  onCopy,
  onNewCharge,
  merchantName,
  merchantRif,
  cashierName,
}: {
  charge: ConfirmedCharge;
  accounts: readonly CheckoutAccount[];
  copied: boolean;
  onCopy: (code: string) => void | Promise<void>;
  onNewCharge: () => void;
  merchantName?: string;
  merchantRif?: string;
  cashierName?: string;
}) {
  return (
    <>
      <div className="flex items-center gap-3.5">
        <span className={MARK_OK}>
          <Icon name="check" />
        </span>
        <div className="flex-1">
          <DialogTitle className="text-xl">Pago confirmado</DialogTitle>
          <span className="text-xs text-muted-foreground">
            {charge.latencyMs === null
              ? 'Movimiento confirmado'
              : `Respondió en ${formatSeconds(charge.latencyMs)}`}
          </span>
        </div>
        {charge.isSandbox && (
          <Badge variant="outline">
            <Icon name="flask" />
            Sandbox
          </Badge>
        )}
      </div>

      <ControlCode code={charge.controlCode} copied={copied} onCopy={onCopy} />
      <ChargeRows charge={charge} accountLabel={accountLabel(accounts, charge.bankAccountId)} />

      <div className="flex gap-2.5">
        <Button variant="secondary" className="flex-1" onClick={() => window.print()}>
          <Icon name="printer" />
          Recibo
        </Button>
        <Button className="flex-1" onClick={onNewCharge}>
          Nuevo cobro
        </Button>
      </div>

      <ThermalReceipt data={chargeReceipt(charge, { merchantName, merchantRif, cashierName })} />
    </>
  );
}

// ── the bank did not confirm ────────────────────────────────────────────────
function VerdictContent({
  outcome,
  reference,
  amountCents,
  onRetry,
  onNewCharge,
  onEdit,
}: {
  outcome: Exclude<ChargeOutcome, { status: 'confirmed' }>;
  reference: string;
  amountCents: number | null;
  onRetry: () => void;
  onNewCharge: () => void;
  onEdit: () => void;
}) {
  const verdict = readVerdict(outcome, reference, amountCents);

  // "Ya fue cobrado" says who charged it and how long ago — the till's answer
  // to "¿entonces quién lo cobró?".
  const chargedNote =
    outcome.status === 'already_charged'
      ? `Validado por ${outcome.by ?? 'otra caja'} · ${formatRelativeTime(outcome.at, Math.floor(Date.now() / 1000))}`
      : null;
  return (
    <>
      <div className="flex flex-col items-center gap-3.5 text-center">
        <span className={MARK_QUIET}>
          <Icon name={verdict.icon} />
        </span>
        <DialogTitle className="text-[22px]">{verdict.title}</DialogTitle>
        <span className="max-w-[42ch] text-[13px] text-muted-foreground">{verdict.body}</span>
        {chargedNote !== null && (
          <span className="text-[13px] font-medium text-foreground">{chargedNote}</span>
        )}
      </div>
      <div className="flex gap-2.5">
        {verdict.retry ? (
          <Button variant="secondary" className="flex-1" onClick={onRetry}>
            <Icon name="arrows-clockwise" />
            Reintentar
          </Button>
        ) : (
          <Button variant="secondary" className="flex-1" onClick={onNewCharge}>
            Nuevo cobro
          </Button>
        )}
        <Button className="flex-1" onClick={onEdit}>
          <Icon name="pencil-simple" />
          Verificar datos
        </Button>
      </div>
      <p className="m-0 text-center text-[11px] text-muted-foreground">
        Este intento no se guarda como cobro.
      </p>
    </>
  );
}

// ── the "mi turno" re-open modal — the shared "cobro validado" modal ─────────
function ValidatedModal({
  charge,
  accounts,
  merchantName,
  merchantRif,
  cashierName,
  onClose,
}: {
  /**
   * A row of "mi turno", not any confirmed charge: only that list opens this
   * modal, and it is what carries the payer's bank down to it.
   */
  charge: RecentCharge;
  accounts: readonly CheckoutAccount[];
  merchantName?: string;
  merchantRif?: string;
  cashierName?: string;
  onClose: () => void;
}) {
  // The bank that received it is the connection the charge landed on, read back
  // from the list rather than passed down as one name for the whole till: a
  // merchant can have two connected, and they are not interchangeable.
  const received = accounts.find((account) => account.id === charge.bankAccountId);
  const bankName = received?.bankName ?? 'el banco';

  return (
    <ValidatedPaymentModal
      view={{
        controlCode: charge.controlCode,
        amountCents: charge.amountCents,
        reference: charge.reference,
        payerPhone: charge.payerPhone,
        kind: charge.kind,
        payerBankName: findBank(charge.sourceBankId)?.name ?? charge.sourceBankId,
        bankName,
        cashierName,
        accountLabel: accountLabel(accounts, charge.bankAccountId),
        paidAt: charge.paidAt,
        chargedAt: charge.createdAt,
        isSandbox: charge.isSandbox,
        receipt: chargeReceipt(charge, { bankName, merchantName, merchantRif, cashierName }),
      }}
      onClose={onClose}
    />
  );
}

/** The control-code hero with a copy button — shared by the result and the modal. */
function ControlCode({
  code,
  copied,
  onCopy,
}: {
  code: string;
  copied: boolean;
  onCopy: (code: string) => void | Promise<void>;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed border-[var(--color-accent-700)] bg-primary/[0.07] p-3.5">
      <div className="flex-1">
        <span className={KICKER}>Código de control</span>
        <div className="font-heading text-[28px] tracking-[0.14em] tabular-nums text-primary">
          {code}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label={copied ? 'Código copiado' : 'Copiar el código de control'}
        onClick={() => void onCopy(code)}
      >
        <Icon name={copied ? 'check' : 'copy'} />
      </Button>
    </div>
  );
}

/** The monto / referencia / teléfono / cuenta / fecha rows. */
function ChargeRows({
  charge,
  accountLabel: account,
}: {
  charge: ConfirmedCharge;
  accountLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-2.5 text-[13px]">
      <Row label="Monto" strong value={formatBolivares(charge.amountCents)} />
      <Row label="Tipo" value={kindLabel(charge.kind)} />
      <Row label="Referencia" mono value={charge.reference} />
      {/* A transferencia has no payer phone; the row is absent, not empty. */}
      {charge.payerPhone !== null && (
        <Row label="Teléfono" value={formatPhoneForDisplay(charge.payerPhone)} />
      )}
      {/* The two banks, named the way the re-opened receipt and the validations
          table name them: where it came from, then where it landed. */}
      <Row
        label="Banco emisor"
        value={findBank(charge.sourceBankId)?.name ?? charge.sourceBankId}
      />
      {account !== undefined && <Row label="Banco receptor" value={account} />}
      {/* The bank's date first: it is the customer's, it is what their receipt
          says, and on a payment made last night it is not today. "Cobrado" is
          the shop's own — the two are different facts and the counter states
          both rather than picking one and calling it "Fecha". */}
      <Row label="Fecha del pago" value={formatBankDateTime(charge.paidAt)} />
      <Row label="Cobrado" value={formatDateTime(charge.createdAt)} />
    </div>
  );
}

/** A label/value row in the confirmation details. */
function Row({
  label,
  value,
  strong,
  mono,
}: {
  label: string;
  value: string;
  strong?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn(mono && 'tabular-nums', strong && 'font-heading text-[17px]')}>
        {value}
      </span>
    </div>
  );
}

/** The three answers that are not a confirmation, in the words the counter uses. */
type Verdict = {
  readonly icon: 'magnifying-glass' | 'receipt' | 'warning-circle';
  readonly title: string;
  readonly body: string;
  /** Whether *Reintentar* makes sense, or only *Nuevo cobro*. */
  readonly retry: boolean;
};

/**
 * A confirmed charge is rendered as the success card, never as a verdict, so it
 * is excluded from the input here — which also lets the compiler narrow the
 * final branch to `failed`.
 */
function readVerdict(
  outcome: Exclude<ChargeOutcome, { status: 'confirmed' }>,
  reference: string,
  amountCents: number | null,
): Verdict {
  const amount = amountCents === null ? '' : ` por ${formatBolivares(amountCents)}`;

  if (outcome.status === 'not_found') {
    return {
      icon: 'magnifying-glass',
      title: 'Todavía no aparece',
      body: `No aparece un pago con la referencia ${reference}${amount}. Si el cliente pagó desde otro banco, puede tardar unos minutos.`,
      retry: true,
    };
  }

  if (outcome.status === 'already_charged') {
    return {
      icon: 'receipt',
      title: 'Ese pago ya fue cobrado',
      body: 'Otra caja registró este mismo movimiento. Un pago se cobra una sola vez.',
      retry: false,
    };
  }

  if (outcome.status === 'rejected') {
    return {
      icon: 'warning-circle',
      title: 'No coincide con el movimiento',
      body: REJECTION_COPY[outcome.reason],
      retry: false,
    };
  }

  return {
    icon: 'warning-circle',
    title: 'El banco no pudo responder',
    body: FAILURE_COPY[outcome.failure],
    retry: outcome.failure !== 'no_bank_account' && outcome.failure !== 'rejected_credentials',
  };
}

/**
 * A rejection is a movement the bank *does* report and that is not the payment
 * claimed. It is never "todavía no aparece" — the difference matters at the
 * counter, because one of them is worth retrying and the other is not.
 */
const REJECTION_COPY = {
  amount_mismatch: 'El banco reporta ese pago por otro monto. Revisa el monto del cobro.',
  not_a_credit: 'Ese movimiento no es un pago recibido en la cuenta de la tienda.',
  unsupported_currency: 'Ese movimiento no está en bolívares.',
  reference_mismatch: 'La referencia no corresponde a ese movimiento.',
} as const;

const FAILURE_COPY = {
  no_bank_account:
    'Esta tienda todavía no tiene una cuenta conectada. Avisa a quien administra el negocio.',
  invalid_input: 'Revisa la referencia, el teléfono y el monto.',
  rejected_credentials:
    'El banco rechazó las credenciales de la tienda. Hay que re-verificarlas en Bancos.',
  maintenance: 'El banco está en mantenimiento. Intenta en unos minutos.',
  unavailable: 'El banco no pudo responder. Intenta de nuevo.',
  timeout: 'Tardó demasiado. Intenta de nuevo.',
} as const;
