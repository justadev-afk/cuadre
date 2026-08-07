/**
 * State shapes for the bank-onboarding wizard. Split from `actions.ts` because
 * a `'use server'` module may only export async functions — a type or a
 * constant beside the actions makes the whole file fail the RSC build.
 */

export type SelectableAccountView = {
  readonly accountId: string;
  readonly masked: string;
  readonly type: string | null;
  readonly balanceCents: number | null;
};

export type VerifyState =
  | { readonly step: 'idle' }
  | {
      readonly step: 'error';
      /** The `credentialGroups` key the refusal belongs to, so the form points at it. */
      readonly groupKey: string;
      readonly message: string;
    }
  | {
      readonly step: 'accounts';
      readonly verifyId: string;
      readonly environment: 'production' | 'sandbox';
      /**
       * From a discover pair. Empty when the merchant gave none — the next step
       * is then a field to type the receiving number in rather than a picker.
       */
      readonly accounts: readonly SelectableAccountView[];
    };

export const VERIFY_INITIAL: VerifyState = { step: 'idle' };

export type ConnectState =
  | { readonly step: 'idle' }
  | { readonly step: 'error'; readonly message: string }
  | { readonly step: 'done' };

export const CONNECT_INITIAL: ConnectState = { step: 'idle' };
