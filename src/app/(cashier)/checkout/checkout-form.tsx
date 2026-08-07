'use client';

/**
 * The counter — v2 screens 11, 12, 15, 16, 17, 26.
 *
 * A two-pane till: the form on the left, "mi turno" on the right. The reference,
 * the amount, the in-flight spinner and the bank's answer all replace each other
 * in place, because a cashier with a customer waiting must not lose a typed
 * reference to a navigation. The bank call itself stays on the server — this
 * component awaits `chargeAction` and never speaks to a bank.
 *
 * The rules that decide whether a submission is even askable are the domain's,
 * imported directly: `parseAmountToCents` refuses an amount that is not an exact
 * count of cents, `normalisePhone` refuses a number with no pago móvil behind
 * it. Re-implementing either here is how the counter and the use case start
 * disagreeing about what a valid claim is.
 */
import { useId, useRef, useState } from 'react';

import { formatBolivares, parseAmountToCents } from '../../../domain/money.ts';
import { formatPhoneForDisplay, normalisePhone } from '../../../domain/phone.ts';
import { findBank, SUDEBAN_BANKS } from '../../../domain/sudeban.ts';
import { Icon } from '../../_components/icon.tsx';
import { BankSpinner } from '../../_components/skeleton.tsx';
import { maskCurrency, maskPhone } from '../../_lib/masks.ts';
import { formatDateTime, formatSeconds } from '../../_lib/venezuela-format.ts';
import { chargeAction } from './actions.ts';
import type { ChargeOutcome } from './charge-types.ts';

/** One row of the "mi turno" list on the right pane. */
export type RecentCharge = {
  readonly controlCode: string;
  readonly amountCents: number;
  readonly label: string;
};

type CheckoutFormProps = {
  /** The bank that answers — the one holding the company's receiving account. */
  bankName: string;
  /** All the UI ever shows of the receiving account. */
  accountLast4: string;
  /** Which of the company's accounts answers. Sandbox only when there is no other. */
  environment: 'production' | 'sandbox';
  /** The last few charges on this till, for the right pane. */
  recent: readonly RecentCharge[];
  turnoCount: number;
  turnoCents: number;
};

export function CheckoutForm({
  bankName,
  accountLast4,
  environment,
  recent,
  turnoCount,
  turnoCents,
}: CheckoutFormProps) {
  const referenceId = useId();
  const phoneId = useId();
  const bankId = useId();
  const amountId = useId();

  const [reference, setReference] = useState('');
  const [phone, setPhone] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [amount, setAmount] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ChargeOutcome | null>(null);
  const [copied, setCopied] = useState(false);

  /**
   * One key per *submission*, not per request: a retry of the same typed data
   * carries the same key, so a payment that lands between two attempts is
   * charged once and reads back with the same control code. Editing any field
   * makes it a different submission and clears it.
   */
  const idempotencyKey = useRef<string | null>(null);
  /** Which attempt the screen is waiting for. *Cancelar* just stops caring. */
  const attempt = useRef(0);

  const bank = findBank(bankCode);
  const amountCents = parseAmountToCents(amount);

  function edited(): void {
    idempotencyKey.current = null;
    setProblem(null);
  }

  async function send(): Promise<void> {
    const cents = parseAmountToCents(amount);
    const payerPhone = normalisePhone(phone);

    if (reference.trim() === '') return setProblem('Falta la referencia del pago.');
    if (payerPhone === null) return setProblem('Ese teléfono no es un móvil venezolano.');
    if (bank === null) return setProblem('Elige el banco desde el que pagó el cliente.');
    if (cents === null || cents <= 0) return setProblem('Escribe el monto del cobro.');

    const key = idempotencyKey.current ?? crypto.randomUUID();
    idempotencyKey.current = key;

    const mine = attempt.current + 1;
    attempt.current = mine;
    setProblem(null);
    setOutcome(null);
    setBusy(true);

    const answer = await chargeAction({
      reference: reference.trim(),
      payerPhone,
      sourceBankId: bank.code,
      amountCents: cents,
      idempotencyKey: key,
      environment,
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
    setBankCode('');
    setAmount('');
    setOutcome(null);
    setProblem(null);
    setBusy(false);
    setCopied(false);
  }

  function backToForm(): void {
    attempt.current += 1;
    setOutcome(null);
    setBusy(false);
  }

  async function copyControlCode(code: string): Promise<void> {
    await navigator.clipboard.writeText(code);
    setCopied(true);
  }

  // ── the bank is answering ─────────────────────────────────────────────────
  if (busy) {
    return (
      <div className="cx-result">
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
            <div className="sk" style={{ height: 11, width: '55%', animationDelay: '.2s' }} />
          </div>
          {/* Cancelling stops the screen from waiting, not the payment from being
              confirmed: the idempotency key survives, so resubmitting the same
              data returns that same charge rather than making a second one. */}
          <button type="button" className="btn btn-secondary btn-block" onClick={backToForm}>
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  // ── the bank answered ─────────────────────────────────────────────────────
  if (outcome !== null) {
    if (outcome.status === 'confirmed') {
      const { charge } = outcome;
      return (
        <div className="cx-result">
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

          <div className="control-hero" style={{ flexDirection: 'row', alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <span className="cx-kicker">Código de control</span>
              <div className="control-hero-num">{charge.controlCode}</div>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              aria-label={copied ? 'Código copiado' : 'Copiar el código de control'}
              onClick={() => void copyControlCode(charge.controlCode)}
            >
              <Icon name={copied ? 'check' : 'copy'} />
            </button>
          </div>

          <div className="cx-details">
            <Row label="Monto" strong value={formatBolivares(charge.amountCents)} />
            <Row label="Referencia" mono value={charge.reference} />
            <Row label="Teléfono" value={formatPhoneForDisplay(charge.payerPhone)} />
            <Row label="Fecha" value={formatDateTime(charge.createdAt)} />
          </div>

          <div className="cx-actions">
            <button type="button" className="btn btn-secondary" onClick={() => window.print()}>
              <Icon name="printer" />
              Recibo
            </button>
            <button type="button" className="btn btn-primary" onClick={newCharge}>
              Nuevo cobro
            </button>
          </div>
        </div>
      );
    }

    const verdict = readVerdict(outcome, bankName, reference, amountCents);
    return (
      <div className="cx-result">
        <div className="cx-verdict cx-verdict-column">
          <span className="cx-mark cx-mark-quiet">
            <Icon name={verdict.icon} />
          </span>
          <div style={{ fontFamily: 'var(--font-heading)', fontSize: 22 }}>{verdict.title}</div>
          <span className="text-muted cx-verdict-body">{verdict.body}</span>
        </div>
        <div className="cx-actions">
          {verdict.retry ? (
            <button type="button" className="btn btn-secondary" onClick={() => void send()}>
              <Icon name="arrows-clockwise" />
              Reintentar
            </button>
          ) : (
            <button type="button" className="btn btn-secondary" onClick={newCharge}>
              Nuevo cobro
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={backToForm}>
            <Icon name="pencil-simple" />
            Verificar datos
          </button>
        </div>
        <p className="text-muted" style={{ fontSize: 11, textAlign: 'center', margin: 0 }}>
          Este intento no se guarda como cobro.
        </p>
      </div>
    );
  }

  // ── the till ──────────────────────────────────────────────────────────────
  return (
    <div className="till">
      <form
        className="till-form"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <div>
          <h4 style={{ margin: '0 0 2px' }}>Validar pago móvil</h4>
          <span className="text-muted" style={{ fontSize: 12 }}>
            Pide al cliente la referencia completa y su teléfono.
          </span>
        </div>

        <div className="field">
          <label htmlFor={referenceId}>Referencia completa</label>
          <input
            id={referenceId}
            className="input tnum cx-reference"
            value={reference}
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
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
              className="input cx-phone"
              value={phone}
              inputMode="tel"
              autoComplete="off"
              placeholder="0414-3125566"
              onChange={(event) => {
                setPhone(maskPhone(event.target.value));
                edited();
              }}
            />
          </div>

          <div className="field">
            <label htmlFor={bankId}>Banco emisor</label>
            <select
              id={bankId}
              className="input cx-bank-select"
              value={bankCode}
              onChange={(event) => {
                setBankCode(event.target.value);
                edited();
              }}
            >
              <option value="">Elige el banco</option>
              {SUDEBAN_BANKS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.code} · {option.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor={amountId}>Monto del cobro</label>
          <div className="cx-amount">
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

        {problem !== null && (
          <p className="cx-problem" role="alert">
            {problem}
          </p>
        )}

        <button type="submit" className="btn btn-primary cx-submit">
          Validar
          <Icon name="arrow-right" />
        </button>

        <p className="cx-note">
          <Icon name="bank" style={{ marginTop: 2 }} />
          <span>
            Consultamos a {bankName} con la referencia, el teléfono y el monto. Cuenta receptora
            ···· {accountLast4}.
          </span>
        </p>
      </form>

      <aside className="till-turno">
        <div className="till-turno-head">
          <span style={{ fontFamily: 'var(--font-heading)', fontSize: 14 }}>Mi turno</span>
        </div>
        <div className="cx-pair" style={{ gap: 10 }}>
          <div className="card elev-sm" style={{ gap: 1, padding: 11 }}>
            <span className="cx-kicker">Validados</span>
            <span style={{ fontFamily: 'var(--font-heading)', fontSize: 20 }}>{turnoCount}</span>
          </div>
          <div className="card elev-sm" style={{ gap: 1, padding: 11 }}>
            <span className="cx-kicker">Cobrado</span>
            <span className="tnum" style={{ fontFamily: 'var(--font-heading)', fontSize: 20 }}>
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
              <div className="till-recent-row" key={row.controlCode}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="tnum" style={{ fontFamily: 'var(--font-heading)', fontSize: 15 }}>
                    {formatBolivares(row.amountCents)}
                  </div>
                  <span className="text-muted" style={{ fontSize: 11 }}>
                    {row.label}
                  </span>
                </div>
                <span className="tnum" style={{ fontSize: 12, color: 'var(--color-accent-300)' }}>
                  {row.controlCode}
                </span>
              </div>
            ))}
          </div>
        )}

        <a href="/my-validations" style={{ fontSize: 12, marginTop: 'auto' }}>
          Ver todas mis validaciones
        </a>
      </aside>
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
