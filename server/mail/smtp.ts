import nodemailer from 'nodemailer';
import { readEnv } from '../env';

export type MailDelivery = {
  sent: boolean;
  reason?: string;
};

export type MailMessage = {
  to: string | string[];
  subject: string;
  text: string;
  replyTo?: string;
};

const DEFAULT_SMTP_HOST = 'smtp.hostinger.com';
const DEFAULT_SMTP_PORT = 465;
const DEFAULT_SMTP_FROM = 'Atlaix Support <support@atlaix.com>';

function smtpConfig() {
  const port = Number(readEnv('SMTP_PORT') || DEFAULT_SMTP_PORT);
  return {
    host: readEnv('SMTP_HOST') || DEFAULT_SMTP_HOST,
    port: Number.isFinite(port) ? port : DEFAULT_SMTP_PORT,
    secure: (readEnv('SMTP_SECURE') || 'true').toLowerCase() !== 'false',
    user: readEnv('SMTP_USER'),
    pass: readEnv('SMTP_PASS'),
    from: readEnv('SMTP_FROM') || DEFAULT_SMTP_FROM
  };
}

export function supportEmail() {
  return readEnv('SUPPORT_EMAIL') || 'support@atlaix.com';
}

export async function sendMail(message: MailMessage): Promise<MailDelivery> {
  const config = smtpConfig();
  if (!config.user || !config.pass) {
    return { sent: false, reason: 'SMTP_USER and SMTP_PASS are not configured.' };
  }

  try {
    const transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass
      }
    });

    await transport.sendMail({
      from: config.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      replyTo: message.replyTo
    });
    return { sent: true };
  } catch (error) {
    return {
      sent: false,
      reason: error instanceof Error ? error.message : 'Email could not be sent.'
    };
  }
}
