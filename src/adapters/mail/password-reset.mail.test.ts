import { describe, expect, it } from 'vitest';

import { EmailBindingMailer, type PasswordResetMail } from './password-reset.mail.ts';

/**
 * `SendEmail.send` is overloaded: raw MIME, or the field builder. This mailer
 * only ever uses the builder, so that is the shape the fake keeps.
 */
function fakeEmail(): { email: SendEmail; sent: EmailMessageBuilder[] } {
  const sent: EmailMessageBuilder[] = [];

  const email: SendEmail = {
    async send(message: EmailMessage | EmailMessageBuilder): Promise<EmailSendResult> {
      if ('subject' in message) sent.push(message);
      return { messageId: 'fake-message' };
    },
  };

  return { email, sent };
}

const MAIL: PasswordResetMail = {
  to: 'maria@la-espiga.ve',
  resetUrl: 'https://cuadre.jsansossio.com/reset?token=opaque',
  name: 'María R.',
};

describe('password reset mail', () => {
  it('sends from the configured address to the address that asked', async () => {
    const { email, sent } = fakeEmail();

    await new EmailBindingMailer(email, 'no-reply@cuadre.jsansossio.com').sendPasswordReset(MAIL);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.from).toBe('no-reply@cuadre.jsansossio.com');
    expect(sent[0]?.to).toBe('maria@la-espiga.ve');
    expect(sent[0]?.subject).toBe('Recupera tu acceso a Cuadre');
  });

  it('carries the link and its expiry in both parts, so no client is left without one', async () => {
    const { email, sent } = fakeEmail();

    await new EmailBindingMailer(email, 'no-reply@cuadre.jsansossio.com').sendPasswordReset(MAIL);

    for (const part of [sent[0]?.text, sent[0]?.html]) {
      expect(part).toContain(MAIL.resetUrl);
      expect(part).toContain('30 minutos');
    }
    // No images: a mail that only renders with remote content is unreadable.
    expect(sent[0]?.html).not.toContain('<img');
  });

  it('escapes the name into the HTML part rather than interpolating it raw', async () => {
    const { email, sent } = fakeEmail();

    await new EmailBindingMailer(email, 'no-reply@cuadre.jsansossio.com').sendPasswordReset({
      ...MAIL,
      name: 'María <b>R.</b>',
    });

    expect(sent[0]?.html).toContain('Hola María &lt;b&gt;R.&lt;/b&gt;,');
  });
});
