/**
 * Every mutation endpoint, named once.
 *
 * A URL is a contract between a client component and a route handler, and a
 * contract spelled out in two files drifts in one of them — the same reason
 * `banks/credentials.ts` owns the `<groupKey>.clientId` field names (§11). The
 * folder under `src/app/api/` and the constant here are the two halves; only
 * this file writes the path as a string.
 */
export const API = {
  signInCompany: '/api/sign-in/company',
  signInCashier: '/api/sign-in/cashier',
  signInAdmin: '/api/sign-in/admin',
  forgotPassword: '/api/forgot-password',
  resetPassword: '/api/reset-password',
  /** The four-hour prompt's *sigo yo*. Posted by a plain form, without script. */
  shiftAck: '/api/shift-ack',

  banksConnect: '/api/banks/connect',
  banksCredentials: '/api/banks/credentials',
  banksDeactivate: '/api/banks/deactivate',

  employeesCreate: '/api/employees/create',
  employeesUpdate: '/api/employees/update',
  /** Access, both directions. A user row is never deleted — see the handler. */
  employeesStatus: '/api/employees/status',

  changePassword: '/api/profile/password',
  companiesCreate: '/api/companies/create',

  /** The counter's two reads-and-writes. JSON in, JSON out — not a form post. */
  charge: '/api/checkout/charge',
  receivingAccounts: '/api/checkout/receiving-accounts',
  myValidations: '/api/my-validations',
  /** The company panel's list, one page at a time — and the two it prefetches. */
  validations: '/api/validations',
} as const;
