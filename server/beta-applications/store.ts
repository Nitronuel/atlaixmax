import { createHash, randomBytes } from 'node:crypto';
import { readEnv } from '../env';

export type BetaApplicationStatus = 'pending' | 'approved' | 'rejected' | 'registered';

export type BetaApplication = {
  id: string;
  fullName: string;
  email: string;
  xUsername: string | null;
  telegramUsername: string | null;
  intendedUse: string | null;
  status: BetaApplicationStatus;
  inviteExpiresAt: string | null;
  inviteSentAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  registeredAt: string | null;
  registeredUserId: string | null;
  reviewedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BetaApplicationInput = {
  fullName?: string;
  email?: string;
  xUsername?: string;
  telegramUsername?: string;
  intendedUse?: string;
};

type BetaApplicationRow = {
  id: string;
  full_name: string;
  email: string;
  x_username: string | null;
  telegram_username: string | null;
  intended_use: string | null;
  status: BetaApplicationStatus;
  invite_expires_at: string | null;
  invite_sent_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  registered_at: string | null;
  registered_user_id: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
};

const APPLICATION_COLUMNS = [
  'id',
  'full_name',
  'email',
  'x_username',
  'telegram_username',
  'intended_use',
  'status',
  'invite_expires_at',
  'invite_sent_at',
  'approved_at',
  'rejected_at',
  'registered_at',
  'registered_user_id',
  'reviewed_by',
  'created_at',
  'updated_at'
].join(',');

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function getSupabaseConfig() {
  const url = readEnv('SUPABASE_URL', 'VITE_SUPABASE_URL').replace(/\/$/, '');
  const key = readEnv('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY');
  return { url, key };
}

function appBaseUrl() {
  return (readEnv('BETA_APP_BASE_URL', 'VITE_APP_BASE_URL') || 'https://beta.atlaix.com').replace(/\/+$/, '');
}

async function supabaseFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) throw new Error('Supabase service role is not configured.');

  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {})
    }
  });

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(`Supabase beta application request failed (${response.status}). ${message}`.trim());
  }

  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

function normalizeRow(row: BetaApplicationRow): BetaApplication {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    xUsername: row.x_username,
    telegramUsername: row.telegram_username,
    intendedUse: row.intended_use,
    status: row.status,
    inviteExpiresAt: row.invite_expires_at,
    inviteSentAt: row.invite_sent_at,
    approvedAt: row.approved_at,
    rejectedAt: row.rejected_at,
    registeredAt: row.registered_at,
    registeredUserId: row.registered_user_id,
    reviewedBy: row.reviewed_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function optionalText(value: unknown, maxLength: number) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  return text.slice(0, maxLength);
}

function normalizeEmail(value: unknown) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error('A valid email address is required.');
  }
  return email;
}

function normalizeApplicationInput(input: BetaApplicationInput) {
  const fullName = optionalText(input.fullName, 120);
  if (!fullName || fullName.length < 2) throw new Error('Full name is required.');

  return {
    full_name: fullName,
    email: normalizeEmail(input.email),
    x_username: optionalText(input.xUsername, 80),
    telegram_username: optionalText(input.telegramUsername, 80),
    intended_use: optionalText(input.intendedUse, 1200)
  };
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function createInviteToken() {
  return randomBytes(32).toString('base64url');
}

function inviteUrl(token: string) {
  return `${appBaseUrl()}/create-account?token=${encodeURIComponent(token)}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildPrivateBetaInviteEmail(fullName: string, link: string) {
  const name = fullName.trim() || 'there';
  const subject = 'Welcome to Atlaix Private Beta';
  const logoUrl = `${appBaseUrl()}/logo.png`;
  const text = [
    `Hi ${name},`,
    '',
    'Thank you for your interest in Atlaix.',
    '',
    "We're excited to let you know that your application has been approved. You're now invited to join the Atlaix Private Beta and get early access before our public launch.",
    '',
    'Click the button below to create your account and get started.',
    '',
    `Create Your Account: ${link}`,
    '',
    'This invitation is linked to your approved email address and is intended for you only.',
    '',
    "We're excited to have you with us. Your feedback will help shape the future of Atlaix.",
    '',
    'Welcome aboard!'
  ].join('\n');
  const safeName = escapeHtml(name);
  const safeLink = escapeHtml(link);
  const safeLogoUrl = escapeHtml(logoUrl);
  const html = [
    '<!doctype html>',
    '<html>',
    '<body style="margin:0;background:#f5f7f8;font-family:Inter,Arial,sans-serif;color:#111827;">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f7f8;padding:32px 16px;">',
    '<tr>',
    '<td align="center">',
    '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #dce5df;border-radius:16px;overflow:hidden;">',
    '<tr>',
    '<td style="padding:32px;">',
    `<img src="${safeLogoUrl}" width="44" height="44" alt="Atlaix" style="display:block;width:44px;height:44px;border-radius:12px;margin:0 0 18px;" />`,
    '<div style="font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#2f8f46;">Atlaix Private Beta</div>',
    `<h1 style="margin:12px 0 24px;font-size:28px;line-height:1.2;color:#111827;">Welcome to Atlaix Private Beta</h1>`,
    `<p style="margin:0 0 16px;font-size:16px;line-height:1.65;">Hi ${safeName},</p>`,
    '<p style="margin:0 0 16px;font-size:16px;line-height:1.65;">Thank you for your interest in Atlaix.</p>',
    '<p style="margin:0 0 16px;font-size:16px;line-height:1.65;">We&#39;re excited to let you know that your application has been approved. You&#39;re now invited to join the Atlaix Private Beta and get early access before our public launch.</p>',
    '<p style="margin:0 0 24px;font-size:16px;line-height:1.65;">Click the button below to create your account and get started.</p>',
    `<p style="margin:0 0 24px;"><a href="${safeLink}" style="display:inline-block;background:#2f8f46;color:#ffffff;text-decoration:none;font-weight:700;border-radius:10px;padding:14px 20px;">Create Your Account</a></p>`,
    '<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#4b5563;">This invitation is linked to your approved email address and is intended for you only.</p>',
    '<p style="margin:0 0 16px;font-size:16px;line-height:1.65;">We&#39;re excited to have you with us. Your feedback will help shape the future of Atlaix.</p>',
    '<p style="margin:0;font-size:16px;line-height:1.65;">Welcome aboard!</p>',
    '</td>',
    '</tr>',
    '</table>',
    '</td>',
    '</tr>',
    '</table>',
    '</body>',
    '</html>'
  ].join('');

  return { subject, text, html };
}

async function findByEmail(email: string) {
  const params = new URLSearchParams({
    select: `${APPLICATION_COLUMNS},invite_token_hash`,
    email: `eq.${email}`,
    limit: '1'
  });
  const rows = await supabaseFetch<Array<BetaApplicationRow & { invite_token_hash?: string | null }>>(`beta_applications?${params.toString()}`);
  return rows[0] || null;
}

async function findById(id: string) {
  const params = new URLSearchParams({
    select: `${APPLICATION_COLUMNS},invite_token_hash`,
    id: `eq.${id}`,
    limit: '1'
  });
  const rows = await supabaseFetch<Array<BetaApplicationRow & { invite_token_hash?: string | null }>>(`beta_applications?${params.toString()}`);
  return rows[0] || null;
}

async function findByInviteToken(token: string) {
  const params = new URLSearchParams({
    select: APPLICATION_COLUMNS,
    invite_token_hash: `eq.${hashToken(token)}`,
    limit: '1'
  });
  const rows = await supabaseFetch<BetaApplicationRow[]>(`beta_applications?${params.toString()}`);
  return rows[0] || null;
}

async function updateApplication(id: string, patch: Record<string, unknown>) {
  const params = new URLSearchParams({
    id: `eq.${id}`,
    select: APPLICATION_COLUMNS
  });
  const rows = await supabaseFetch<BetaApplicationRow[]>(`beta_applications?${params.toString()}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(patch)
  });
  if (!rows[0]) throw new Error('Application was not found.');
  return normalizeRow(rows[0]);
}

export async function createBetaApplication(input: BetaApplicationInput) {
  const payload = normalizeApplicationInput(input);
  const existing = await findByEmail(payload.email);

  if (existing) {
    if (existing.status === 'pending') {
      return updateApplication(existing.id, payload);
    }
    return normalizeRow(existing);
  }

  const rows = await supabaseFetch<BetaApplicationRow[]>('beta_applications?select=' + encodeURIComponent(APPLICATION_COLUMNS), {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ ...payload, status: 'pending' })
  });
  if (!rows[0]) throw new Error('Application could not be saved.');
  return normalizeRow(rows[0]);
}

export async function listBetaApplications(status?: string) {
  const params = new URLSearchParams({
    select: APPLICATION_COLUMNS,
    order: 'created_at.desc',
    limit: '200'
  });
  if (status && ['pending', 'approved', 'rejected', 'registered'].includes(status)) {
    params.set('status', `eq.${status}`);
  }
  const rows = await supabaseFetch<BetaApplicationRow[]>(`beta_applications?${params.toString()}`);
  return rows.map(normalizeRow);
}

export async function approveBetaApplication(id: string, reviewerId: string, resend = false) {
  const existing = await findById(id);
  if (!existing) throw new Error('Application was not found.');
  if (existing.status === 'registered') throw new Error('This applicant is already registered.');

  const token = createInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  const delivery = await sendInviteEmail(existing.email, existing.full_name, inviteUrl(token));
  const application = await updateApplication(id, {
    status: 'approved',
    invite_token_hash: hashToken(token),
    invite_expires_at: expiresAt,
    invite_sent_at: delivery.sent ? new Date().toISOString() : existing.invite_sent_at,
    approved_at: existing.approved_at || new Date().toISOString(),
    rejected_at: null,
    reviewed_by: reviewerId
  });

  return {
    application,
    inviteUrl: inviteUrl(token),
    email: delivery,
    resent: resend
  };
}

export async function rejectBetaApplication(id: string, reviewerId: string) {
  const existing = await findById(id);
  if (!existing) throw new Error('Application was not found.');
  if (existing.status === 'registered') throw new Error('Registered applicants cannot be rejected.');

  return updateApplication(id, {
    status: 'rejected',
    invite_token_hash: null,
    invite_expires_at: null,
    rejected_at: new Date().toISOString(),
    reviewed_by: reviewerId
  });
}

export async function deleteBetaApplication(id: string) {
  const params = new URLSearchParams({
    id: `eq.${id}`,
    select: APPLICATION_COLUMNS
  });
  const rows = await supabaseFetch<BetaApplicationRow[]>(`beta_applications?${params.toString()}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' }
  });
  if (!rows[0]) throw new Error('Application was not found.');
  return normalizeRow(rows[0]);
}

export async function verifyInviteToken(token: string) {
  if (!token.trim()) throw new Error('Invite token is required.');
  const row = await findByInviteToken(token);
  if (!row || row.status !== 'approved') throw new Error('This invitation is invalid or expired.');
  if (!row.invite_expires_at || Date.now() > new Date(row.invite_expires_at).getTime()) {
    throw new Error('This invitation has expired.');
  }
  return normalizeRow(row);
}

export async function registerInvitedUser(input: { token?: string; password?: string; displayName?: string }) {
  const token = typeof input.token === 'string' ? input.token.trim() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  if (password.length < 12) throw new Error('Password must be at least 12 characters.');

  const application = await verifyInviteToken(token);
  const user = await createSupabaseUser({
    email: application.email,
    password,
    displayName: optionalText(input.displayName, 120) || application.fullName
  });

  const nextApplication = await updateApplication(application.id, {
    status: 'registered',
    registered_user_id: user.id,
    registered_at: new Date().toISOString(),
    invite_token_hash: null,
    invite_expires_at: null
  });

  return { application: nextApplication, user: { id: user.id, email: user.email } };
}

async function createSupabaseUser(input: { email: string; password: string; displayName: string }) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) throw new Error('Supabase service role is not configured.');

  const response = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { display_name: input.displayName }
    })
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof payload?.message === 'string' ? payload.message : 'Account could not be created.';
    throw new Error(message);
  }

  const id = typeof payload?.id === 'string' ? payload.id : '';
  if (!id) throw new Error('Account could not be created.');
  return { id, email: input.email };
}

async function sendInviteEmail(email: string, fullName: string, link: string) {
  const apiKey = readEnv('RESEND_API_KEY');
  const from = readEnv('RESEND_FROM_EMAIL') || 'Atlaix <hello@atlaix.com>';
  const invite = buildPrivateBetaInviteEmail(fullName, link);
  if (!apiKey) {
    return { sent: false, reason: 'Email provider is not configured.' };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: invite.subject,
      text: invite.text,
      html: invite.html
    })
  });

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    return { sent: false, reason: message || `Email provider returned ${response.status}.` };
  }

  return { sent: true };
}
