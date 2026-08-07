/**
 * Transactional mail through the Worker's own Email Sending binding: no
 * third-party API key, and SPF/DKIM/DMARC handled by Cloudflare when the
 * domain is verified.
 *
 * The copy here is Spanish because a user reads it. Everything else in this
 * file, including the template, is English.
 */

export type PasswordResetMail = {
  to: string;
  resetUrl: string;
  name: string;
};

export interface Mailer {
  sendPasswordReset(mail: PasswordResetMail): Promise<void>;
}

/** Thirty minutes, stated in the mail so the reader knows before clicking. */
const VALID_FOR = '30 minutos';

export class EmailBindingMailer implements Mailer {
  constructor(
    private readonly email: SendEmail,
    private readonly from: string,
  ) {}

  async sendPasswordReset(mail: PasswordResetMail): Promise<void> {
    await this.email.send({
      from: this.from,
      to: mail.to,
      subject: 'Recupera tu acceso a Cuadre',
      text: [
        `Hola ${mail.name},`,
        '',
        'Abre este enlace para crear una contraseña nueva:',
        mail.resetUrl,
        '',
        `Vence en ${VALID_FOR}. Si no lo pediste, ignora este correo.`,
      ].join('\n'),
      html: template(mail),
    });
  }
}

/**
 * A table, no images and no external CSS. Half of these arrive in a client
 * that will not load a stylesheet, and an image-only mail is a mail nobody can
 * read.
 */
function template(mail: PasswordResetMail): string {
  return `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:24px;background:#161826;color:#e9e9ed;font-family:Inter,system-ui,sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto">
      <tr>
        <td style="padding-bottom:20px;font-size:18px;font-weight:500">Cuadre</td>
      </tr>
      <tr>
        <td style="padding-bottom:12px;font-size:15px">Hola ${escapeHtml(mail.name)},</td>
      </tr>
      <tr>
        <td style="padding-bottom:20px;font-size:15px;line-height:1.55">
          Abre este enlace para crear una contraseña nueva.
        </td>
      </tr>
      <tr>
        <td style="padding-bottom:20px">
          <a href="${escapeHtml(mail.resetUrl)}"
             style="display:inline-block;padding:10px 18px;border:1px solid #9184d9;border-radius:8px;color:#9184d9;text-decoration:none;font-size:14px">
            Crear contraseña nueva
          </a>
        </td>
      </tr>
      <tr>
        <td style="font-size:13px;color:#9397ab;line-height:1.55">
          Vence en ${VALID_FOR}. Si no lo pediste, ignora este correo.
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
