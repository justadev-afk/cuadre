'use client';

/**
 * The counter. Four fields, one question, and three things the bank can answer
 * (screens 15, 16, 17 and 26).
 *
 * This is the one screen in the product with real client state, and it earns it:
 * the picker, the amount, the in-flight spinner and the result all replace each
 * other in place, and a cashier with a customer waiting must not lose a typed
 * reference to a navigation. The bank call itself stays on the server — this
 * component awaits `chargeAction` and never speaks to a bank or to an API of
 * ours.
 *
 * The rules that decide whether a submission is even askable are the domain's,
 * imported directly: `parseAmountToCents` refuses an amount that is not an
 * exact count of cents, `normalisePhone` refuses a number with no pago móvil
 * behind it, and `searchBanks` is the same filter the picker on the server would
 * use. Re-implementing any of them here is how the counter and the use case
 * start disagreeing about what a valid claim is.
 */
import { useId, useRef, useState } from 'react';

import { formatBolivares, parseAmountToCents } from '../../../domain/money.ts';
import { formatPhoneForDisplay, normalisePhone } from '../../../domain/phone.ts';
import { findBank, SUDEBAN_BANKS, searchBanks } from '../../../domain/sudeban.ts';
import { Icon } from '../../_components/icon.tsx';
import { BankSpinner } from '../../_components/skeleton.tsx';
import { maskPhone } from '../../_lib/masks.ts';
import { formatDateTime, formatSeconds } from '../../_lib/venezuela-format.ts';
import { chargeAction } from './actions.ts';
import type { ChargeOutcome } from './charge-types.ts';

type CheckoutFormProps = {
  /** The bank that answers — the one holding the company's receiving account. */
  bankName: string;
  /** All the UI ever shows of the receiving account. */
  accountLast4: string;
  /** Which of the company's accounts answers. Sandbox only when there is no other. */
  environment: 'production' | 'sandbox';
};

/** What the screen is showing. The result and the spinner are states, not routes. */
type View = 'form' | 'banks';

export function CheckoutForm({ bankName, accountLast4, environment }: CheckoutFormProps) {
  const referenceId = useId();
  const phoneId = useId();
  const bankId = useId();
  const amountId = useId();
  const searchId = useId();

  const [view, setView] = useState<View>('form');
  const [reference, setReference] = useState('');
  const [phone, setPhone] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [amount, setAmount] = useState('');
  const [editingAmount, setEditingAmount] = useState(true);
  const [query, setQuery] = useState('');
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
  const results = searchBanks(query);

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
    setEditingAmount(true);
    setOutcome(null);
    setProblem(null);
    setBusy(false);
    setCopied(false);
  }

  function backToForm(): void {
    attempt.current += 1;
    setOutcome(null);
    setBusy(false);
    setView('form');
  }

  async function copyControlCode(code: string): Promise<void> {
    await navigator.clipboard.writeText(code);
    setCopied(true);
  }

  // ── the bank is answering (screen 26) ─────────────────────────────────────
  if (busy) {
    return (
      <div className="cx-panel">
        <div className="cx-waiting">
          <BankSpinner />
          <div style={{ fontFamily: 'var(--font-heading)', fontSize: 19 }}>
            Consultando a {bankName}
          </div>
          <span className="text-muted tnum" style={{ fontSize: 12 }}>
            Ref. {reference} · {amountCents === null ? '' : formatBolivares(amountCents)}
          </span>
        </div>
        <div className="hr" style={{ margin: 0 }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="sk" style={{ height: 11, width: '80%' }} />
          <div className="sk" style={{ height: 11, width: '55%', animationDelay: '.2s' }} />
        </div>
        {/*
          The bank keeps answering after this: cancelling stops the screen from
          waiting, not the payment from being confirmed. The idempotency key
          survives, so submitting the same data again returns that same charge
          rather than making a second one.
        */}
        <button type="button" className="btn btn-secondary btn-block" onClick={backToForm}>
          Cancelar
        </button>
      </div>
    );
  }

  // ── the bank answered (screen 17) ─────────────────────────────────────────
  if (outcome !== null) {
    if (outcome.status === 'confirmed') {
      const { charge } = outcome;
      return (
        <div className="cx-panel">
          <div className="cx-verdict">
            <span className="cx-mark cx-mark-ok">
              <Icon name="check" />
            </span>
            <div style={{ fontFamily: 'var(--font-heading)', fontSize: 22 }}>Pago confirmado</div>
            <span className="text-muted" style={{ fontSize: 12 }}>
              {charge.latencyMs === null
                ? `${bankName} confirmó el movimiento`
                : `${bankName} respondió en ${formatSeconds(charge.latencyMs)}`}
            </span>
            {charge.isSandbox && (
              <span className="tag tag-outline">
                <Icon name="flask" style={{ marginRight: 4 }} />
                Sandbox
              </span>
            )}
          </div>

          <div className="cx-code-box">
            <div style={{ flex: 1 }}>
              <div className="cx-kicker">Código de control</div>
              <div className="cx-control tnum">{charge.controlCode}</div>
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
            <div className="cx-row">
              <span className="text-muted">Monto</span>
              <span style={{ fontFamily: 'var(--font-heading)', fontSize: 17 }}>
                {formatBolivares(charge.amountCents)}
              </span>
            </div>
            <div className="cx-row">
              <span className="text-muted">Referencia</span>
              <span className="tnum">{charge.reference}</span>
            </div>
            <div className="cx-row">
              <span className="text-muted">Teléfono</span>
              <span>{formatPhoneForDisplay(charge.payerPhone)}</span>
            </div>
            <div className="cx-row">
              <span className="text-muted">Fecha</span>
              <span>{formatDateTime(charge.createdAt)}</span>
            </div>
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
      <div className="cx-panel">
        <div className="cx-verdict">
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
      </div>
    );
  }

  // ── the bank picker (screen 16) ───────────────────────────────────────────
  if (view === 'banks') {
    return (
      <div className="cx-panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            aria-label="Volver al cobro"
            onClick={() => setView('form')}
          >
            <Icon name="arrow-left" />
          </button>
          <h4 style={{ margin: 0, fontSize: 18 }}>Banco emisor</h4>
        </div>

        <div className="input cx-search">
          <Icon name="magnifying-glass" style={{ color: 'var(--color-neutral-500)' }} />
          <input
            id={searchId}
            className="cx-search-input"
            placeholder="Nombre o código"
            value={query}
            autoComplete="off"
            aria-label="Buscar un banco por nombre o código"
            onChange={(event) => setQuery(event.target.value)}
          />
          <span className="text-muted" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
            {results.length} de {SUDEBAN_BANKS.length}
          </span>
        </div>
        <span className="cx-kicker">Busca por nombre o código</span>

        <div className="cx-bank-list">
          {results.map((option) => (
            <button
              key={option.code}
              type="button"
              className="cx-bank"
              onClick={() => {
                setBankCode(option.code);
                setQuery('');
                setView('form');
                edited();
              }}
            >
              <span className="cx-bank-code tnum">{option.code}</span>
              <span style={{ fontSize: 14 }}>{option.name}</span>
            </button>
          ))}
          {results.length === 0 && (
            <span className="text-muted" style={{ fontSize: 13, padding: '10px 8px' }}>
              Ningún banco con ese nombre o código.
            </span>
          )}
        </div>
      </div>
    );
  }

  // ── the form (screen 15) ──────────────────────────────────────────────────
  return (
    <form
      className="cx-form"
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
          onChange={(event) => {
            setReference(event.target.value);
            edited();
          }}
        />
      </div>

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

      <div className="cx-pair">
        <div className="field">
          <label htmlFor={bankId}>Banco emisor</label>
          <button
            id={bankId}
            type="button"
            className="input cx-select"
            onClick={() => setView('banks')}
          >
            {bank === null ? (
              <span className="text-muted">Elige el banco</span>
            ) : (
              <>
                <span className="cx-bank-code tnum">{bank.code}</span>
                {bank.name}
              </>
            )}
            <Icon name="caret-down" className="cx-caret" />
          </button>
        </div>

        <div className="field">
          <label htmlFor={amountId}>Monto del cobro</label>
          {editingAmount || amountCents === null || amountCents <= 0 ? (
            <input
              id={amountId}
              className="input tnum cx-amount-input"
              value={amount}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,00"
              onChange={(event) => {
                setAmount(event.target.value);
                edited();
              }}
              onBlur={() => {
                const cents = parseAmountToCents(amount);
                if (cents !== null && cents > 0) setEditingAmount(false);
              }}
            />
          ) : (
            <div className="input cx-amount">
              <span className="tnum cx-amount-value">{formatBolivares(amountCents)}</span>
              <button
                type="button"
                className="btn btn-ghost cx-amount-change"
                onClick={() => setEditingAmount(true)}
              >
                Cambiar
              </button>
            </div>
          )}
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
          Consultamos a {bankName} con la referencia, el teléfono y el monto. Cuenta receptora ····{' '}
          {accountLast4}.
        </span>
      </p>
    </form>
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
