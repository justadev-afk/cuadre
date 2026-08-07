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
 */
import { useEffect, useId, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { cn } from '@/lib/utils.ts';
import { formatBolivares, parseAmountToCents } from '../../../domain/money.ts';
import { formatPhoneForDisplay, normalisePhone } from '../../../domain/phone.ts';
import { findBank, SUDEBAN_BANKS } from '../../../domain/sudeban.ts';
import { ContentLayout } from '../../_components/content-layout.tsx';
import { Icon } from '../../_components/icon.tsx';
import { SearchableSelect, type SelectOption } from '../../_components/searchable-select.tsx';
import { BankSpinner } from '../../_components/skeleton.tsx';
import { maskCurrency } from '../../_lib/masks.ts';
import {
  formatClock,
  formatDateTime,
  formatRelativeTime,
  formatSeconds,
} from '../../_lib/venezuela-format.ts';
import { chargeAction } from './actions.ts';
import type { ChargeOutcome, ConfirmedCharge } from './charge-types.ts';

/** One row of the "mi turno" list — a full charge, so a click can re-open it. */
export type RecentCharge = ConfirmedCharge & {
  /** Sudeban code of the payer's bank, for the row's caption. */
  readonly sourceBankId: string;
};

/** One connected receiving account, as the counter's selector shows it. */
export type CheckoutAccount = {
  readonly id: string;
  readonly last4: string;
  readonly bankName: string;
};

type CheckoutFormProps = {
  /** The bank that answers — one name when the accounts share it, else generic. */
  bankName: string;
  /** Every connected account for the environment; the counter asks each in turn. */
  accounts: readonly CheckoutAccount[];
  /** Which of the company's accounts answer. Sandbox only when there is no other. */
  environment: 'production' | 'sandbox';
  /** The last few charges on this till, for the right pane. */
  recent: readonly RecentCharge[];
  turnoCount: number;
  turnoCents: number;
};

/** The Venezuelan banks, shaped once for the searchable dropdown. */
const BANK_OPTIONS: readonly SelectOption[] = SUDEBAN_BANKS.map((bank) => ({
  value: bank.code,
  label: bank.name,
  hint: bank.code,
}));

/** Where the last-chosen payer bank is remembered between charges. */
const LAST_BANK_KEY = 'cuadre.last-bank';

// Shared Nocturne shapes as utility strings.
const BOX_LG = 'flex flex-col gap-3.5 rounded-xl border border-border bg-card p-[26px]';
const BOX_QUIET = 'flex flex-col gap-3.5 rounded-xl border border-border bg-sidebar px-[22px] py-5';
const KICKER = 'text-[10px] font-normal tracking-[0.1em] text-muted-foreground uppercase';
const MARK_OK =
  'grid size-[52px] shrink-0 place-items-center rounded-full border border-primary bg-primary/[0.14] text-2xl text-primary';
const MARK_QUIET =
  'grid size-[52px] shrink-0 place-items-center rounded-full border border-[var(--color-neutral-500)] bg-foreground/[0.07] text-2xl text-[var(--color-neutral-300)]';
const STAT_CARD =
  'flex min-h-[76px] flex-col items-center justify-center gap-0.5 rounded-md bg-card px-2.5 py-3.5 text-center shadow-[var(--shadow-sm)]';
// The inset-fade hairline under a "mi turno" row — the table's row rule, on a button.
const RECENT_ROW =
  'flex w-full cursor-pointer items-center gap-2.5 -mx-1.5 rounded-sm px-1.5 py-[9px] text-left transition-colors hover:bg-foreground/[0.06] bg-[linear-gradient(to_right,transparent,color-mix(in_srgb,var(--color-text)_8%,transparent)_20px,color-mix(in_srgb,var(--color-text)_8%,transparent)_calc(100%-20px),transparent)] bg-[length:100%_1px] bg-bottom bg-no-repeat';
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

/** "Banesco ···· 5394" for the account a charge landed on, or undefined if unknown. */
function accountLabel(
  accounts: readonly CheckoutAccount[],
  bankAccountId: string,
): string | undefined {
  const account = accounts.find((a) => a.id === bankAccountId);
  return account ? `${account.bankName} ···· ${account.last4}` : undefined;
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
  bankName,
  accounts,
  environment,
  recent,
  turnoCount,
  turnoCents,
}: CheckoutFormProps) {
  const referenceId = useId();
  const phoneId = useId();
  const bankId = useId();
  const amountId = useId();
  const accountSelectId = useId();

  const [reference, setReference] = useState('');
  const [phone, setPhone] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ChargeOutcome | null>(null);
  const [copied, setCopied] = useState(false);
  /** A past charge the cashier tapped in "mi turno", shown read-only in a modal. */
  const [viewing, setViewing] = useState<ConfirmedCharge | null>(null);

  // Which receiving account to ask. One account → that one; several → null, the
  // "todas las cuentas" default, and the counter asks each until the bank
  // reports the payment. The optional selector below narrows it to one.
  const [accountId, setAccountId] = useState<string | null>(
    accounts.length === 1 ? (accounts[0]?.id ?? null) : null,
  );
  const selectedAccount = accounts.find((a) => a.id === accountId) ?? null;

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
  // thing on screen — on load and after a modal closes — without reaching for
  // the mouse.
  const referenceRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!busy && outcome === null) referenceRef.current?.focus();
  }, [busy, outcome]);

  const bank = findBank(bankCode);
  const amountCents = parseAmountToCents(amount);

  // ── realtime validity — the Validar button reads these, and each typed-but-
  //    wrong field turns red. Empty is never red: a field you have not filled is
  //    not a field you got wrong.
  const refValid = reference.trim().length > 0;
  const phoneValid = normalisePhone(phone) !== null;
  const bankValid = bank !== null;
  const amountValid = amountCents !== null && amountCents > 0;
  const canSubmit = refValid && phoneValid && bankValid && amountValid;

  const phoneInvalid = phone !== '' && !phoneValid;
  const amountInvalid = amount !== '' && !amountValid;

  function edited(): void {
    idempotencyKey.current = null;
  }

  function chooseBank(code: string): void {
    setBankCode(code);
    if (code !== '') localStorage.setItem(LAST_BANK_KEY, code);
    edited();
  }

  /** Clears the per-charge fields (the bank stays — it repeats all shift). */
  function clearFields(): void {
    idempotencyKey.current = null;
    setReference('');
    setPhone('');
    setAmount('');
  }

  async function send(): Promise<void> {
    const cents = parseAmountToCents(amount);
    const payerPhone = normalisePhone(phone);
    // The button gates this, but Enter can still fire a form: the same rules,
    // once more, silently — a disabled path, not an error message.
    if (reference.trim() === '' || payerPhone === null || bank === null || cents === null) return;

    const key = idempotencyKey.current ?? crypto.randomUUID();
    idempotencyKey.current = key;

    const mine = attempt.current + 1;
    attempt.current = mine;
    setOutcome(null);
    setBusy(true);

    const answer = await chargeAction({
      reference: reference.trim(),
      payerPhone,
      sourceBankId: bank.code,
      amountCents: cents,
      idempotencyKey: key,
      environment,
      accountId: accountId ?? undefined,
    });

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
    />
  );

  return (
    <ContentLayout
      title="Validar pago móvil"
      subtitle="Pide al cliente la referencia completa y su teléfono."
      aside={aside}
      asideTitle="Mi turno"
    >
      <form
        className={BOX_LG}
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={referenceId}>Referencia completa</Label>
          <Input
            ref={referenceRef}
            id={referenceId}
            className="h-[66px] text-center text-[30px] tracking-[0.06em] tabular-nums max-[899px]:h-[58px] max-[899px]:text-[26px]"
            value={reference}
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            maxLength={20}
            placeholder="0000000000"
            onChange={(event) => {
              setReference(event.target.value.replace(/\D/g, ''));
              edited();
            }}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={phoneId}>Teléfono del pagador</Label>
            <Input
              id={phoneId}
              aria-invalid={phoneInvalid}
              value={phone}
              inputMode="tel"
              autoComplete="off"
              maxLength={12}
              placeholder="0414-3125566"
              onChange={(event) => {
                setPhone(formatPhoneLoose(event.target.value));
                edited();
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={bankId}>Banco emisor</Label>
            <SearchableSelect
              id={bankId}
              options={BANK_OPTIONS}
              value={bankCode}
              onChange={chooseBank}
              placeholder="Elige el banco"
              searchPlaceholder="Buscar banco…"
            />
          </div>
        </div>

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
              className="min-w-0 flex-1 border-none bg-transparent p-0 text-right font-heading text-[22px] tabular-nums text-foreground caret-primary outline-none"
              value={amount}
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

        <Button type="submit" className="mt-0.5 h-[50px] text-base" disabled={!canSubmit}>
          Validar
          <Icon name="arrow-right" />
        </Button>

        {accounts.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={accountSelectId}>Cuenta receptora</Label>
            <SearchableSelect
              id={accountSelectId}
              options={[
                { value: '', label: `Todas las cuentas (${accounts.length})` },
                ...accounts.map((account) => ({
                  value: account.id,
                  label: `${account.bankName} ···· ${account.last4}`,
                  hint: account.last4,
                })),
              ]}
              value={accountId ?? ''}
              onChange={(value) => setAccountId(value === '' ? null : value)}
              searchPlaceholder="Buscar cuenta…"
            />
          </div>
        )}

        <p className="mt-auto flex items-start gap-2 text-xs text-muted-foreground">
          <Icon name="bank" className="mt-0.5" />
          <span>
            {selectedAccount === null
              ? accounts.length > 1
                ? `Consultamos a ${bankName} en tus ${accounts.length} cuentas receptoras.`
                : `Consultamos a ${bankName} con la referencia, el teléfono y el monto. Cuenta receptora ···· ${accounts[0]?.last4 ?? ''}.`
              : `Consultamos a ${selectedAccount.bankName} con la referencia, el teléfono y el monto. Cuenta receptora ···· ${selectedAccount.last4}.`}
          </span>
        </p>
      </form>

      {(busy || outcome !== null) && (
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
        />
      )}

      {viewing !== null && (
        <ValidatedModal
          charge={viewing}
          bankName={bankName}
          accounts={accounts}
          onClose={() => setViewing(null)}
        />
      )}
    </ContentLayout>
  );
}

// ── the right aside: "mi turno" ─────────────────────────────────────────────
function MiTurno({
  recent,
  turnoCount,
  turnoCents,
  onOpen,
}: {
  recent: readonly RecentCharge[];
  turnoCount: number;
  turnoCents: number;
  onOpen: (charge: ConfirmedCharge) => void;
}) {
  return (
    <section className={BOX_QUIET}>
      {/* Cobrado gets the wider column — a bolívar total runs into the millions,
          Validados is a small count — and both stack centred, kicker over value. */}
      <div className="grid grid-cols-[0.7fr_1.3fr] gap-2.5">
        <div className={STAT_CARD}>
          <span className={KICKER}>Validados</span>
          <span className="font-heading text-[22px]">{turnoCount}</span>
        </div>
        <div className={STAT_CARD}>
          <span className={KICKER}>Cobrado</span>
          <span className="font-heading text-[19px] whitespace-nowrap tabular-nums">
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
        <div className="flex flex-col">
          {recent.map((row) => (
            <button
              type="button"
              className={RECENT_ROW}
              key={row.controlCode}
              onClick={() => onOpen(row)}
              title="Ver este cobro"
            >
              <div className="min-w-0 flex-1 text-left">
                <div className="font-heading text-[15px] tabular-nums">
                  {formatBolivares(row.amountCents)}
                </div>
                <span className="text-[11px] text-muted-foreground">
                  {formatClock(row.createdAt)} · ref {row.reference} · {row.sourceBankId}
                </span>
              </div>
              <span className="text-xs tabular-nums text-[var(--color-accent-300)]">
                {row.controlCode}
              </span>
            </button>
          ))}
        </div>
      )}

      <a href="/my-validations" className="mt-auto text-xs">
        Ver todas mis validaciones
      </a>
    </section>
  );
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
}) {
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
}: {
  charge: ConfirmedCharge;
  accounts: readonly CheckoutAccount[];
  copied: boolean;
  onCopy: (code: string) => void | Promise<void>;
  onNewCharge: () => void;
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

// ── the "mi turno" re-open modal ────────────────────────────────────────────
function ValidatedModal({
  charge,
  bankName,
  accounts,
  onClose,
}: {
  charge: ConfirmedCharge;
  bankName: string;
  accounts: readonly CheckoutAccount[];
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className={MODAL_CLASS} aria-describedby={undefined}>
        <div className="flex items-center gap-3.5">
          <span className={MARK_OK}>
            <Icon name="check" />
          </span>
          <div className="flex-1">
            <DialogTitle className="text-xl">Cobro validado</DialogTitle>
            <span className="text-xs text-muted-foreground">
              {bankName} · {formatDateTime(charge.createdAt)}
            </span>
          </div>
          {charge.isSandbox && (
            <Badge variant="outline">
              <Icon name="flask" />
              Sandbox
            </Badge>
          )}
        </div>

        <ControlCode
          code={charge.controlCode}
          copied={copied}
          onCopy={async (code) => {
            await navigator.clipboard.writeText(code);
            setCopied(true);
          }}
        />
        <ChargeRows charge={charge} accountLabel={accountLabel(accounts, charge.bankAccountId)} />

        <Button size="block" className="h-10" onClick={onClose}>
          Cerrar
        </Button>
      </DialogContent>
    </Dialog>
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
      <Row label="Referencia" mono value={charge.reference} />
      <Row label="Teléfono" value={formatPhoneForDisplay(charge.payerPhone)} />
      {account !== undefined && <Row label="Cuenta" value={account} />}
      <Row label="Fecha" value={formatDateTime(charge.createdAt)} />
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
