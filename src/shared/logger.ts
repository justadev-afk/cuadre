/**
 * The only module allowed to call `console` (biome.json enforces it).
 *
 * One JSON object per line so Workers Logs can filter on a field. What must
 * never appear: a client secret, a bank OAuth token, a full account number, a
 * raw IP, or a full payment reference in the clear.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

type Fields = Record<string, string | number | boolean | null | undefined>;

function emit(level: Level, event: string, fields: Fields = {}): void {
  const line = JSON.stringify({ level, event, ...prune(fields) });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function prune(fields: Fields): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export const logger = {
  debug: (event: string, fields?: Fields) => emit('debug', event, fields),
  info: (event: string, fields?: Fields) => emit('info', event, fields),
  warn: (event: string, fields?: Fields) => emit('warn', event, fields),
  error: (event: string, fields?: Fields) => emit('error', event, fields),
};

/**
 * A reference is a customer's payment identifier. Logs keep only enough of it
 * to correlate a support call — the last four digits — never the whole thing.
 */
export function maskReference(reference: string): string {
  return reference.length <= 4 ? '****' : `****${reference.slice(-4)}`;
}
