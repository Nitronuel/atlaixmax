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
    fallbackDisabled: readEnv('SMTP_DISABLE_FALLBACK').toLowerCase() === 'true'
  };
}

export function supportEmail() {
  return readEnv('SUPPORT_EMAIL') || 'support@atlaix.com';
}

export async function sendMail(message: MailMessage): Promise<MailDelivery> {
  const config = smtpConfig();
  const errors: string[] = [];

  if (config.user && config.pass) {
    const smtpDelivery = await sendSmtpMail(config, message);
    if (smtpDelivery.sent) return smtpDelivery;
    if (smtpDelivery.reason) errors.push(smtpDelivery.reason);
  } else {
    errors.push('SMTP_USER and SMTP_PASS are not configured.');
  }

  const resendDelivery = await sendResendMail(message);
  if (resendDelivery.sent) return resendDelivery;
  if (resendDelivery.reason) errors.push(resendDelivery.reason);

  return { sent: false, reason: errors.filter(Boolean).join(' | ') || 'Email could not be sent.' };
}

async function sendSmtpMail(config: ReturnType<typeof smtpConfig>, message: MailMessage): Promise<MailDelivery> {
  const attempts = [{ port: config.port, secure: config.secure }];
  if (!config.fallbackDisabled && config.port === 465) {
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

async function sendResendMail(message: MailMessage): Promise<MailDelivery> {
  const apiKey = readEnv('RESEND_API_KEY');
  if (!apiKey) return { sent: false, reason: 'RESEND_API_KEY is not configured.' };

  const from = readEnv('RESEND_FROM_EMAIL', 'SMTP_FROM') || DEFAULT_SMTP_FROM;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(message.to) ? message.to : [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.replyTo ? { reply_to: message.replyTo } : {})
      })
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { sent: false, reason: `Resend failed (${response.status}). ${text}`.trim() };
    }

    return { sent: true };
  } catch (error) {
    return {
      sent: false,
      reason: error instanceof Error ? error.message : 'Resend email could not be sent.'
    };
  }
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
