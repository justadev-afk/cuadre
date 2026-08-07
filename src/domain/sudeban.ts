/**
 * The Sudeban bank codes — the paying bank a customer picks before typing a
 * reference.
 *
 * This list is the payer's side of a pago móvil and is unrelated to which
 * banks Cuadre can *read* (that is `src/adapters/banks/registry.ts`, one entry
 * today). A customer paying from Bancamiga into a Banesco merchant account is
 * the normal case, so the picker must offer all 26 regardless of which
 * gateways exist.
 */

export type SudebanBank = {
  /** Four digits, zero-padded. Matches `validations.source_bank_id`. */
  readonly code: string;
  readonly name: string;
};

export const SUDEBAN_BANKS: readonly SudebanBank[] = [
  { code: '0102', name: 'Banco de Venezuela' },
  { code: '0104', name: 'Venezolano de Crédito' },
  { code: '0105', name: 'Mercantil' },
  { code: '0108', name: 'Provincial' },
  { code: '0114', name: 'Bancaribe' },
  { code: '0115', name: 'Exterior' },
  { code: '0128', name: 'Banco Caroní' },
  { code: '0134', name: 'Banesco' },
  { code: '0137', name: 'Sofitasa' },
  { code: '0138', name: 'Banco Plaza' },
  { code: '0146', name: 'Bangente' },
  { code: '0151', name: 'BFC Banco Fondo Común' },
  { code: '0156', name: '100% Banco' },
  { code: '0157', name: 'DelSur' },
  { code: '0163', name: 'Banco del Tesoro' },
  { code: '0166', name: 'Banco Agrícola de Venezuela' },
  { code: '0168', name: 'Bancrecer' },
  { code: '0169', name: 'Mi Banco' },
  { code: '0171', name: 'Banco Activo' },
  { code: '0172', name: 'Bancamiga' },
  { code: '0174', name: 'Banplus' },
  { code: '0175', name: 'Banco Bicentenario' },
  { code: '0177', name: 'Banfanb' },
  { code: '0178', name: 'N58 Banco Digital' },
  { code: '0191', name: 'BNC' },
  { code: '0601', name: 'Instituto Municipal de Crédito Popular' },
];

const BY_CODE: ReadonlyMap<string, SudebanBank> = new Map(
  SUDEBAN_BANKS.map((bank) => [bank.code, bank]),
);

/**
 * Exact match on the canonical four digits — no trimming and no zero-padding.
 * `'134'` is not a bank code, and a lookup lenient enough to resolve it is a
 * lookup lenient enough to let it reach `validations.source_bank_id`, where it
 * would no longer join against anything.
 */
export function findBank(code: string): SudebanBank | null {
  return BY_CODE.get(code) ?? null;
}

export function isValidBankCode(code: string): boolean {
  return BY_CODE.has(code);
}

/**
 * The bank picker's filter. Matches the name or the code, and folds accents so
 * that a cashier typing 'credito' on a keyboard without a tilde still finds
 * Venezolano de Crédito.
 *
 * An empty query is the picker's initial state, not a failed search: it lists
 * everything. Order is always the Sudeban order — the codes are what people
 * who work with these every day recognise.
 */
export function searchBanks(query: string): readonly SudebanBank[] {
  const needle = fold(query);
  if (needle === '') return SUDEBAN_BANKS;
  return SUDEBAN_BANKS.filter(
    (bank) => fold(bank.name).includes(needle) || bank.code.includes(needle),
  );
}

function fold(text: string): string {
  return text
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
