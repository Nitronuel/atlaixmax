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
const DEFAULT_SMTP_TIMEOUT_MS = 8000;

function smtpConfig() {
  const configuredPort = readEnv('SMTP_PORT');
  const configuredSecure = readEnv('SMTP_SECURE');
  const port = Number(configuredPort || DEFAULT_SMTP_PORT);
  return {
    host: readEnv('SMTP_HOST') || DEFAULT_SMTP_HOST,
    port: Number.isFinite(port) ? port : DEFAULT_SMTP_PORT,
    secure: (configuredSecure || 'true').toLowerCase() !== 'false',
    user: readEnv('SMTP_USER'),
    pass: readEnv('SMTP_PASS'),
    from: readEnv('SMTP_FROM') || DEFAULT_SMTP_FROM,
    timeoutMs: Number(readEnv('SMTP_TIMEOUT_MS') || DEFAULT_SMTP_TIMEOUT_MS),
    hasCustomPort: Boolean(configuredPort),
    hasCustomSecure: Boolean(configuredSecure)
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

  const attempts = [{ port: config.port, secure: config.secure }];
  if (!config.hasCustomPort && !config.hasCustomSecure && config.port === 465) {
    attempts.push({ port: 587, secure: false });
  }
  const errors: string[] = [];

  for (const attempt of attempts) {
    const delivery = await sendWithConfig(config, attempt, message);
    if (delivery.sent) return delivery;
    if (delivery.reason) errors.push(delivery.reason);
  }

  return { sent: false, reason: errors.filter(Boolean).join(' | ') || 'Email could not be sent.' };
}

async function sendWithConfig(
  config: ReturnType<typeof smtpConfig>,
  attempt: { port: number; secure: boolean },
  message: MailMessage
): Promise<MailDelivery> {
  try {
    const transport = nodemailer.createTransport({
      host: config.host,
      port: attempt.port,
      secure: attempt.secure,
      connectionTimeout: config.timeoutMs,
      greetingTimeout: config.timeoutMs,
      socketTimeout: config.timeoutMs,
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
    const reason = error instanceof Error ? error.message : 'Email could not be sent.';
    return {
      sent: false,
      reason: `${config.host}:${attempt.port} ${reason}`
    };
  }
}
