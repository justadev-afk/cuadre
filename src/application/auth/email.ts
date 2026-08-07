/**
 * The canonical form of an email address, produced before every lookup and
 * before every insert.
 *
 * `ux_users_email` is a unique index on the raw column and the repository
 * matches it exactly — that is what keeps a login off a table scan — so
 * 'Maria@Bodega.com' and 'maria@bodega.com' have to be folded together here or
 * they become two accounts and one of them can never sign in.
 *
 * It sits in the application layer rather than in `src/domain` only because an
 * address carries no other rule worth a module. Case folding is all of it:
 * trimming and lower-casing are safe on the whole address in practice, and
 * anything cleverer (stripping dots, `+tags`) would decide that two addresses
 * a mail server treats as different are the same account.
 */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
