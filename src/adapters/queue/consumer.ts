/**
 * The queue consumer: deferred work only, never anything on the checkout path.
 *
 * Two kinds of job today — password-reset mail, so the screen does not wait on
 * SMTP, and a bank call that hit maintenance and earns a backoff. Both are
 * thin adapters over the same use cases the pages call.
 */
import { z } from 'zod';

import type { Bindings } from '../../env.ts';
import { logger } from '../../shared/logger.ts';

export const Job = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('send_password_reset'),
    to: z.email(),
    resetUrl: z.url(),
    name: z.string(),
  }),
]);

export type Job = z.infer<typeof Job>;

export async function handleJob(message: Message<unknown>, env: Bindings): Promise<void> {
  const parsed = Job.safeParse(message.body);

  if (!parsed.success) {
    // A message we cannot even parse will never succeed on a retry. Ack it and
    // log it loudly rather than letting it consume five attempts.
    logger.error('job_unreadable', { id: message.id });
    message.ack();
    return;
  }

  try {
    await run(parsed.data, env);
    message.ack();
  } catch (error) {
    logger.warn('job_failed', {
      id: message.id,
      kind: parsed.data.kind,
      attempt: message.attempts,
      err: error instanceof Error ? error.message : String(error),
    });
    message.retry();
  }
}

async function run(job: Job, env: Bindings): Promise<void> {
  switch (job.kind) {
    case 'send_password_reset': {
      const { EmailBindingMailer } = await import('../mail/password-reset.mail.ts');
      await new EmailBindingMailer(env.EMAIL, env.MAIL_FROM).sendPasswordReset(job);
      return;
    }
  }
}
