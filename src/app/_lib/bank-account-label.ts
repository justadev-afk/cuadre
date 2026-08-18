/**
 * How a connected bank account is named on screen: "Banesco · Caja principal",
 * or just "Banesco" when the merchant never named it.
 *
 * One shop can hold two affiliations of the same bank, so the bank alone is not
 * always an answer — the label is what tells them apart, and the counter's
 * *banco receptor* dropdown, the confirmation, the re-opened receipt and the
 * validations table all have to name the same connection the same way. It was
 * spelled inline in three places before this file, which is exactly how the
 * separator eventually becomes a dash in one of them.
 */
export function bankAccountLabel(bankName: string, label: string | null | undefined): string {
  const named = label?.trim();
  return named ? `${bankName} · ${named}` : bankName;
}
