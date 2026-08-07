'use client';

/**
 * The counter — v2 screens 11, 12, 15, 16, 17, 26.
 *
 * The screen is the shared `ContentLayout`: a left-aligned title, the work in a
 * bordered `.box`, and "mi turno" in the optional right aside. The title and the
 * aside stay put across all three states — the form, the in-flight spinner and
 * the bank's answer only swap the box, because a cashier with a customer waiting
 * must not lose a typed reference to a navigation, and the layout must not jump.
 *
 * The rules that decide whether a submission is even askable are the domain's,
 * imported directly: `parseAmountToCents` refuses an amount that is not an exact
 * count of cents, `normalisePhone` refuses a number with no pago móvil behind
 * it. Re-implementing either here is how the counter and the use case start
 * disagreeing about what a valid claim is — so the Validar button is disabled
 * until they all pass, and a field that is typed-but-wrong turns its border red
 * rather than pushing an error line in that resizes the box.
 */
import { useEffect, useId, useRef, useState } from 'react';

import { formatBolivares, parseAmountToCents } from '../../../domain/money.ts';
import { formatPhoneForDisplay, normalisePhone } from '../../../domain/phone.ts';
import { findBank, SUDEBAN_BANKS } from '../../../domain/sudeban.ts';
import { ContentLayout } from '../../_components/content-layout.tsx';
import { Icon } from '../../_components/icon.tsx';
import { ModalBackdrop } from '../../_components/modal.tsx';
import { SearchableSelect, type SelectOption } from '../../_components/searchable-select.tsx';
import { BankSpinner } from '../../_components/skeleton.tsx';
import { maskCurrency, maskPhone } from '../../_lib/masks.ts';
import { formatClock, formatDateTime, formatSeconds } from '../../_lib/venezuela-format.ts';
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

  // The cashier's hands are on the customer's receipt: the reference is the
  // first thing they type, so focus it whenever the form is the thing on screen
  // — on load and after every charge — without them reaching for the mouse.
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
  }

  function newCharge(): void {
    attempt.current += 1;
    idempotencyKey.current = null;
    setReference('');
    setPhone('');
    setAmount('');
    setOutcome(null);
    setBusy(false);
    setCopied(false);
  }

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
      {busy ? (
        <WaitingBox
          bankName={bankName}
          reference={reference}
          amountCents={amountCents}
          onCancel={backToForm}
        />
      ) : outcome !== null ? (
        <ResultBox
          outcome={outcome}
          bankName={bankName}
          reference={reference}
          amountCents={amountCents}
          copied={copied}
          onCopy={async (code) => {
            await navigator.clipboard.writeText(code);
            setCopied(true);
          }}
          onNewCharge={newCharge}
          onRetry={() => void send()}
          onBackToForm={backToForm}
        />
      ) : (
        <form
          className="box box-lg"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <div className="field">
            <label htmlFor={referenceId}>Referencia completa</label>
            <input
              ref={referenceRef}
              id={referenceId}
              className="input tnum cx-reference"
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

          <div className="cx-pair">
            <div className="field">
              <label htmlFor={phoneId}>Teléfono del pagador</label>
              <input
                id={phoneId}
                className={`input cx-phone${phoneInvalid ? ' input-invalid' : ''}`}
                value={phone}
                inputMode="tel"
                autoComplete="off"
                maxLength={12}
                placeholder="0414-3125566"
                onChange={(event) => {
                  setPhone(maskPhone(event.target.value));
                  edited();
                }}
              />
            </div>

            <div className="field">
              <label htmlFor={bankId}>Banco emisor</label>
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

          <div className="field">
            <label htmlFor={amountId}>Monto del cobro</label>
            <div className={`cx-amount${amountInvalid ? ' input-invalid' : ''}`}>
              <span className="cx-amount-currency">Bs</span>
              <input
                id={amountId}
                className="input tnum cx-amount-input"
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

          <button type="submit" className="btn btn-primary cx-submit" disabled={!canSubmit}>
            Validar
            <Icon name="arrow-right" />
          </button>

          {accounts.length > 1 && (
            <div className="field cx-account">
              <label htmlFor={accountSelectId}>Cuenta receptora</label>
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

          <p className="cx-note">
            <Icon name="bank" style={{ marginTop: 2 }} />
            <span>
              {selectedAccount === null
                ? accounts.length > 1
                  ? `Consultamos a ${bankName} en tus ${accounts.length} cuentas receptoras.`
                  : `Consultamos a ${bankName} con la referencia, el teléfono y el monto. Cuenta receptora ···· ${accounts[0]?.last4 ?? ''}.`
                : `Consultamos a ${selectedAccount.bankName} con la referencia, el teléfono y el monto. Cuenta receptora ···· ${selectedAccount.last4}.`}
            </span>
          </p>
        </form>
      )}

      {viewing !== null && (
        <ValidatedModal charge={viewing} bankName={bankName} onClose={() => setViewing(null)} />
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
    <section className="box box-quiet">
      {/* Cobrado gets the wider column — a bolívar total runs into the millions,
          Validados is a small count — and both stack centred, kicker over value. */}
      <div className="cx-pair" style={{ gap: 10, gridTemplateColumns: '0.7fr 1.3fr' }}>
        <div
          className="card elev-sm"
          style={{
            gap: 2,
            padding: '14px 10px',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            minHeight: 76,
          }}
        >
          <span className="cx-kicker">Validados</span>
          <span style={{ fontFamily: 'var(--font-heading)', fontSize: 22 }}>{turnoCount}</span>
        </div>
        <div
          className="card elev-sm"
          style={{
            gap: 2,
            padding: '14px 10px',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            minHeight: 76,
          }}
        >
          <span className="cx-kicker">Cobrado</span>
          <span
            className="tnum"
            style={{ fontFamily: 'var(--font-heading)', fontSize: 19, whiteSpace: 'nowrap' }}
          >
            {formatBolivares(turnoCents)}
          </span>
        </div>
      </div>

      <span className="cx-kicker" style={{ marginTop: 4 }}>
        Últimos cobros
      </span>
      {recent.length === 0 ? (
        <span className="text-muted" style={{ fontSize: 12 }}>
          Todavía no validas nada en este turno.
        </span>
      ) : (
        <div className="till-recent">
          {recent.map((row) => (
            <button
              type="button"
              className="till-recent-row"
              key={row.controlCode}
              onClick={() => onOpen(row)}
              title="Ver este cobro"
            >
              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <div className="tnum" style={{ fontFamily: 'var(--font-heading)', fontSize: 15 }}>
                  {formatBolivares(row.amountCents)}
                </div>
                <span className="text-muted" style={{ fontSize: 11 }}>
                  {formatClock(row.createdAt)} · ref {row.reference} · {row.sourceBankId}
                </span>
              </div>
              <span className="tnum" style={{ fontSize: 12, color: 'var(--color-accent-300)' }}>
                {row.controlCode}
              </span>
            </button>
          ))}
        </div>
      )}

      <a href="/my-validations" style={{ fontSize: 12, marginTop: 'auto' }}>
        Ver todas mis validaciones
      </a>
    </section>
  );
}

// ── the bank is answering ───────────────────────────────────────────────────
function WaitingBox({
  bankName,
  reference,
  amountCents,
  onCancel,
}: {
  bankName: string;
  reference: string;
  amountCents: number | null;
  onCancel: () => void;
}) {
  return (
    <section className="box box-lg">
      <div className="cx-waiting">
        <BankSpinner />
        <div style={{ fontFamily: 'var(--font-heading)', fontSize: 19 }}>
          Consultando a {bankName}
        </div>
        <span className="text-muted tnum" style={{ fontSize: 12 }}>
          Ref. {reference} · {amountCents === null ? '' : formatBolivares(amountCents)}
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
          <div className="sk" style={{ height: 11, width: '80%' }} />
          <div className="sk" style={{ height: 11, width: '55%' }} />
        </div>
        {/* Cancelling stops the screen from waiting, not the payment from being
            confirmed: the idempotency key survives, so resubmitting the same
            data returns that same charge rather than making a second one. */}
        <button type="button" className="btn btn-secondary btn-block" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </section>
  );
}

// ── the bank answered ───────────────────────────────────────────────────────
function ResultBox({
  outcome,
  bankName,
  reference,
  amountCents,
  copied,
  onCopy,
  onNewCharge,
  onRetry,
  onBackToForm,
}: {
  outcome: ChargeOutcome;
  bankName: string;
  reference: string;
  amountCents: number | null;
  copied: boolean;
  onCopy: (code: string) => void | Promise<void>;
  onNewCharge: () => void;
  onRetry: () => void;
  onBackToForm: () => void;
}) {
  if (outcome.status === 'confirmed') {
    const { charge } = outcome;
    return (
      <section className="box box-lg" style={{ gap: 16 }}>
        <div className="cx-verdict">
          <span className="cx-mark cx-mark-ok">
            <Icon name="check" />
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--font-heading)', fontSize: 22 }}>Pago confirmado</div>
            <span className="text-muted" style={{ fontSize: 12 }}>
              {charge.latencyMs === null
                ? `${bankName} confirmó el movimiento`
                : `${bankName} respondió en ${formatSeconds(charge.latencyMs)}`}
            </span>
          </div>
          {charge.isSandbox && (
            <span className="tag tag-outline">
              <Icon name="flask" style={{ marginRight: 4 }} />
              Sandbox
            </span>
          )}
        </div>

        <ControlCode code={charge.controlCode} copied={copied} onCopy={onCopy} />
        <ChargeRows charge={charge} />

        <div className="cx-actions">
          <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
            <Icon name="printer" />
            Recibo
          </button>
          <button type="button" className="btn btn-primary" onClick={onNewCharge}>
            Nuevo cobro
          </button>
        </div>
      </section>
    );
  }

  const verdict = readVerdict(outcome, bankName, reference, amountCents);
  return (
    <section className="box box-lg" style={{ gap: 16 }}>
      <div className="cx-verdict cx-verdict-column">
        <span className="cx-mark cx-mark-quiet">
          <Icon name={verdict.icon} />
        </span>
        <div style={{ fontFamily: 'var(--font-heading)', fontSize: 22 }}>{verdict.title}</div>
        <span className="text-muted cx-verdict-body">{verdict.body}</span>
      </div>
      <div className="cx-actions">
        {verdict.retry ? (
          <button type="button" className="btn btn-secondary" onClick={onRetry}>
            <Icon name="arrows-clockwise" />
            Reintentar
          </button>
        ) : (
          <button type="button" className="btn btn-secondary" onClick={onNewCharge}>
            Nuevo cobro
          </button>
        )}
        <button type="button" className="btn btn-primary" onClick={onBackToForm}>
          <Icon name="pencil-simple" />
          Verificar datos
        </button>
      </div>
      <p className="text-muted" style={{ fontSize: 11, textAlign: 'center', margin: 0 }}>
        Este intento no se guarda como cobro.
      </p>
    </section>
  );
}

// ── the "mi turno" re-open modal ────────────────────────────────────────────
function ValidatedModal({
  charge,
  bankName,
  onClose,
}: {
  charge: ConfirmedCharge;
  bankName: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <ModalBackdrop onClose={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Cobro validado"
        className="dialog elev-lg"
        style={{ width: 'min(440px, 96vw)', background: 'var(--color-surface)', padding: 24 }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="cx-verdict">
            <span className="cx-mark cx-mark-ok">
              <Icon name="check" />
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'var(--font-heading)', fontSize: 20 }}>Cobro validado</div>
              <span className="text-muted" style={{ fontSize: 12 }}>
                {bankName} · {formatDateTime(charge.createdAt)}
              </span>
            </div>
            {charge.isSandbox && (
              <span className="tag tag-outline">
                <Icon name="flask" style={{ marginRight: 4 }} />
                Sandbox
              </span>
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
          <ChargeRows charge={charge} />

          <button type="button" className="btn btn-primary btn-block" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </ModalBackdrop>
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
    <div className="control-hero" style={{ flexDirection: 'row', alignItems: 'center' }}>
      <div style={{ flex: 1 }}>
        <span className="cx-kicker">Código de control</span>
        <div className="control-hero-num">{code}</div>
      </div>
      <button
        type="button"
        className="btn btn-ghost btn-icon"
        aria-label={copied ? 'Código copiado' : 'Copiar el código de control'}
        onClick={() => void onCopy(code)}
      >
        <Icon name={copied ? 'check' : 'copy'} />
      </button>
    </div>
  );
}

/** The monto / referencia / teléfono / fecha rows, shared by the result and modal. */
function ChargeRows({ charge }: { charge: ConfirmedCharge }) {
  return (
    <div className="cx-details">
      <Row label="Monto" strong value={formatBolivares(charge.amountCents)} />
      <Row label="Referencia" mono value={charge.reference} />
      <Row label="Teléfono" value={formatPhoneForDisplay(charge.payerPhone)} />
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
    <div className="cx-row">
      <span className="text-muted">{label}</span>
      <span
        className={mono ? 'tnum' : undefined}
        style={strong ? { fontFamily: 'var(--font-heading)', fontSize: 17 } : undefined}
      >
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
 * A confirmed charge is rendered as the success screen (see the `confirmed`
 * branch above), never as a verdict card, so it is excluded from the input
 * here — which also lets the compiler narrow the final branch to `failed`.
 */
function readVerdict(
  outcome: Exclude<ChargeOutcome, { status: 'confirmed' }>,
  bankName: string,
  reference: string,
  amountCents: number | null,
): Verdict {
  const amount = amountCents === null ? '' : ` por ${formatBolivares(amountCents)}`;

  if (outcome.status === 'not_found') {
    return {
      icon: 'magnifying-glass',
      title: 'Todavía no aparece',
      body: `${bankName} no reporta un pago con la referencia ${reference}${amount}. Si el cliente pagó desde otro banco, puede tardar unos minutos.`,
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
