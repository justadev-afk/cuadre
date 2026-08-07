/**
 * The Worker entry.
 *
 * vinext would supply this itself (`main: "vinext/server/fetch-handler"`), but
 * the queue consumer needs to live in the same Worker as the app: it retries
 * bank calls that hit maintenance and sends the password-reset mail off the
 * request path, and both need the same bindings the pages use.
 *
 * `virtual:vinext-worker-entry` is resolved by the vinext plugin at build time
 * to the App Router handler, so the pages behave exactly as they would under
 * the default entry. Wiring only — no logic in this file.
 */
import handler from 'vinext/server/fetch-handler';
import { handleJob } from '../src/adapters/queue/consumer.ts';
import type { Bindings } from '../src/env.ts';

export default {
  fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    return handler.fetch(request, env, ctx);
  },

  async queue(batch: MessageBatch<unknown>, env: Bindings): Promise<void> {
    // Each message acks or retries on its own: one poisoned job must not drag
    // the other nine in the batch back through the queue with it.
    await Promise.all(batch.messages.map((message) => handleJob(message, env)));
  },
};
