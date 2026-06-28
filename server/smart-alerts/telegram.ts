import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readEnv } from '../env';
import type { SmartAlertRow, SmartAlertTriggerRow } from './store';

const TELEGRAM_TIMEOUT_MS = 10_000;
const SUPABASE_TIMEOUT_MS = 12_000;
const CONNECTION_COLUMNS = 'id,user_id,telegram_chat_id,telegram_user_id,telegram_username,link_token_hash,link_token_expires_at,connected_at,disconnected_at,created_at,updated_at';

export type TelegramConnectionRow = {
  id: string;
  user_id: string;
  telegram_chat_id: string | null;
  telegram_user_id: string | null;
  telegram_username: string | null;
  link_token_hash: string | null;
  link_token_expires_at: string | null;
  connected_at: string | null;
  disconnected_at: string | null;
  created_at: string;
  updated_at: string;
};

type LocalTelegramState = {
  connections: TelegramConnectionRow[];
};

type TelegramChat = {
  id?: number | string;
  username?: string;
  first_name?: string;
  type?: string;
};

type TelegramUser = {
  id?: number | string;
  username?: string;
  first_name?: string;
};

export type TelegramAlertDeliveryResult = {
  attempted: boolean;
  delivered: boolean;
  reason?: string;
};

let botUsernameCache: string | null = null;

function hasTelegramChannel(rule: SmartAlertRow | null) {
  return Boolean(rule?.notification_channels?.some((channel) => channel.toLowerCase() === 'telegram'));
}

function getSupabaseConfig() {
  const url = readEnv('SUPABASE_URL').replace(/\/$/, '');
  const key = readEnv('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY');
  return { url, key };
}

function getLocalPath() {
  return resolve(process.cwd(), '.data', 'telegram-connections.json');
}

function readLocalState(): LocalTelegramState {
  const filepath = getLocalPath();
  if (!existsSync(filepath)) return { connections: [] };
  try {
    const parsed = JSON.parse(readFileSync(filepath, 'utf8')) as LocalTelegramState;
    return { connections: Array.isArray(parsed.connections) ? parsed.connections : [] };
  } catch {
    return { connections: [] };
  }
}

function writeLocalState(state: LocalTelegramState) {
  const filepath = getLocalPath();
  mkdirSync(dirname(filepath), { recursive: true });
  writeFileSync(filepath, JSON.stringify(state, null, 2));
}

async function supabaseFetch(path: string, init: RequestInit = {}) {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) throw new Error('Supabase is not configured for Telegram connections.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUPABASE_TIMEOUT_MS);

  try {
    const response = await fetch(`${url}/rest/v1/${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        apikey: key,
        Authorization: `Bearer ${key}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers || {})
      }
    });

    if (!response.ok) {
      const message = await response.text().catch(() => '');
      throw new Error(`Supabase Telegram request failed (${response.status}). ${message}`.trim());
    }

    if (response.status === 204) return null;
    return response.json().catch(() => null);
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeConnection(row: any): TelegramConnectionRow {
  const now = new Date().toISOString();
  return {
    id: String(row.id || randomUUID()),
    user_id: String(row.user_id || ''),
    telegram_chat_id: row.telegram_chat_id ? String(row.telegram_chat_id) : null,
    telegram_user_id: row.telegram_user_id ? String(row.telegram_user_id) : null,
    telegram_username: row.telegram_username ? String(row.telegram_username) : null,
    link_token_hash: row.link_token_hash ? String(row.link_token_hash) : null,
    link_token_expires_at: row.link_token_expires_at || null,
    connected_at: row.connected_at || null,
    disconnected_at: row.disconnected_at || null,
    created_at: row.created_at || now,
    updated_at: row.updated_at || now
  };
}

function hashLinkToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function makeLinkToken() {
  return randomBytes(24).toString('base64url');
}

async function getBotUsername() {
  const configured = readEnv('TELEGRAM_BOT_USERNAME').replace(/^@/, '');
  if (configured) return configured;
  if (botUsernameCache) return botUsernameCache;

  const botToken = readEnv('TELEGRAM_BOT_TOKEN');
  if (!botToken) return '';
  const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, {
    headers: { Accept: 'application/json' }
  });
  if (!response.ok) return '';
  const payload = await response.json().catch(() => null);
  botUsernameCache = typeof payload?.result?.username === 'string' ? payload.result.username : '';
  return botUsernameCache || '';
}

async function findConnectionByUserId(userId: string) {
  try {
    const params = new URLSearchParams({
      select: CONNECTION_COLUMNS,
      user_id: `eq.${userId}`,
      disconnected_at: 'is.null',
      order: 'created_at.desc',
      limit: '1'
    });
    const rows = await supabaseFetch(`telegram_connections?${params.toString()}`);
    return Array.isArray(rows) && rows[0] ? normalizeConnection(rows[0]) : null;
  } catch {
    const state = readLocalState();
    return state.connections
      .filter((connection) => connection.user_id === userId && !connection.disconnected_at)
      .sort((left, right) => right.created_at.localeCompare(left.created_at))[0] || null;
  }
}

async function upsertLocalConnection(row: TelegramConnectionRow) {
  const state = readLocalState();
  const index = state.connections.findIndex((connection) => connection.user_id === row.user_id && !connection.disconnected_at);
  if (index >= 0) state.connections[index] = row;
  else state.connections.unshift(row);
  writeLocalState(state);
  return row;
}

async function saveConnection(row: TelegramConnectionRow) {
  try {
    const existing = await findConnectionByUserId(row.user_id);
    if (existing) {
      const params = new URLSearchParams({ id: `eq.${existing.id}`, select: CONNECTION_COLUMNS });
      const rows = await supabaseFetch(`telegram_connections?${params.toString()}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ ...row, id: existing.id, updated_at: new Date().toISOString() })
      });
      return normalizeConnection(Array.isArray(rows) ? rows[0] : rows);
    }

    const rows = await supabaseFetch(`telegram_connections?select=${encodeURIComponent(CONNECTION_COLUMNS)}`, {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(row)
    });
    return normalizeConnection(Array.isArray(rows) ? rows[0] : rows);
  } catch {
    return upsertLocalConnection(row);
  }
}

async function findConnectionByLinkToken(token: string) {
  const tokenHash = hashLinkToken(token);
  try {
    const params = new URLSearchParams({
      select: CONNECTION_COLUMNS,
      link_token_hash: `eq.${tokenHash}`,
      disconnected_at: 'is.null',
      order: 'created_at.desc',
      limit: '1'
    });
    const rows = await supabaseFetch(`telegram_connections?${params.toString()}`);
    return Array.isArray(rows) && rows[0] ? normalizeConnection(rows[0]) : null;
  } catch {
    const state = readLocalState();
    return state.connections.find((connection) => connection.link_token_hash === tokenHash && !connection.disconnected_at) || null;
  }
}

async function updateConnection(connection: TelegramConnectionRow, patch: Partial<TelegramConnectionRow>) {
  const next = normalizeConnection({ ...connection, ...patch, updated_at: new Date().toISOString() });
  try {
    const params = new URLSearchParams({ id: `eq.${connection.id}`, select: CONNECTION_COLUMNS });
    const rows = await supabaseFetch(`telegram_connections?${params.toString()}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(patch)
    });
    return normalizeConnection(Array.isArray(rows) ? rows[0] : rows);
  } catch {
    const state = readLocalState();
    const index = state.connections.findIndex((item) => item.id === connection.id);
    if (index >= 0) state.connections[index] = next;
    else state.connections.unshift(next);
    writeLocalState(state);
    return next;
  }
}

export async function getTelegramConnectionStatus(userId: string) {
  const connection = await findConnectionByUserId(userId);
  const botUsername = await getBotUsername();
  return {
    connected: Boolean(connection?.telegram_chat_id && connection.connected_at && !connection.disconnected_at),
    botUsername,
    telegramUsername: connection?.telegram_username || null,
    connectedAt: connection?.connected_at || null
  };
}

export async function createTelegramLink(userId: string) {
  const botUsername = await getBotUsername();
  if (!botUsername) throw new Error('Telegram bot username is not configured.');

  const now = new Date();
  const token = makeLinkToken();
  const row = normalizeConnection({
    id: randomUUID(),
    user_id: userId,
    telegram_chat_id: null,
    telegram_user_id: null,
    telegram_username: null,
    link_token_hash: hashLinkToken(token),
    link_token_expires_at: new Date(now.getTime() + 15 * 60_000).toISOString(),
    connected_at: null,
    disconnected_at: null,
    created_at: now.toISOString(),
    updated_at: now.toISOString()
  });
  await saveConnection(row);

  return {
    botUsername,
    expiresAt: row.link_token_expires_at,
    url: `https://t.me/${botUsername}?start=connect_${token}`
  };
}

export async function disconnectTelegramConnection(userId: string) {
  const connection = await findConnectionByUserId(userId);
  if (!connection) return null;
  return updateConnection(connection, {
    disconnected_at: new Date().toISOString(),
    link_token_hash: null,
    link_token_expires_at: null
  });
}

export async function completeTelegramLink(token: string, chat: TelegramChat, from?: TelegramUser) {
  const connection = await findConnectionByLinkToken(token);
  if (!connection?.link_token_expires_at) return { linked: false, reason: 'invalid' };
  if (Date.now() > new Date(connection.link_token_expires_at).getTime()) return { linked: false, reason: 'expired' };

  const chatId = chat.id === undefined || chat.id === null ? '' : String(chat.id);
  if (!chatId) return { linked: false, reason: 'missing_chat' };

  await updateConnection(connection, {
    telegram_chat_id: chatId,
    telegram_user_id: from?.id === undefined || from?.id === null ? null : String(from.id),
    telegram_username: from?.username || chat.username || chat.first_name || null,
    link_token_hash: null,
    link_token_expires_at: null,
    connected_at: new Date().toISOString(),
    disconnected_at: null
  });

  return { linked: true, reason: 'connected' };
}

export function parseTelegramStartToken(text: string) {
  const match = /^\/start\s+connect_([A-Za-z0-9_-]+)\s*$/i.exec(text.trim());
  return match?.[1] || '';
}

function trimTelegramText(value: string) {
  return value.length > 3900 ? `${value.slice(0, 3897)}...` : value;
}

function formatTelegramMessage(trigger: SmartAlertTriggerRow, rule: SmartAlertRow | null) {
  const lines = [
    `Atlaix ${trigger.alert_type} Alert`,
    '',
    trigger.message,
    trigger.observed_value ? `Observed: ${trigger.observed_value}` : '',
    trigger.threshold ? `Threshold: ${trigger.threshold}` : '',
    rule?.target ? `Target: ${rule.target}` : '',
    rule?.chain_id ? `Network: ${rule.chain_id}` : ''
  ].filter(Boolean);

  return trimTelegramText(lines.join('\n'));
}

async function postTelegramMessage(botToken: string, chatId: string, text: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS);

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true
      })
    });

    if (!response.ok) {
      const message = await response.text().catch(() => '');
      throw new Error(`Telegram send failed (${response.status}). ${message}`.trim());
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendTelegramAlert(trigger: SmartAlertTriggerRow, rule: SmartAlertRow | null) {
  if (!hasTelegramChannel(rule)) {
    return { attempted: false, delivered: false, reason: 'Telegram is not selected for this alert.' };
  }

  const botToken = readEnv('TELEGRAM_BOT_TOKEN');
  const connection = rule?.user_id ? await findConnectionByUserId(rule.user_id) : null;
  const chatId = connection?.telegram_chat_id || (rule?.user_id ? '' : readEnv('TELEGRAM_CHAT_ID'));
  if (!botToken) {
    return { attempted: true, delivered: false, reason: 'Telegram bot token is not configured.' };
  }
  if (!chatId) {
    return { attempted: true, delivered: false, reason: 'Telegram is selected, but this user has no connected Telegram chat.' };
  }

  try {
    await postTelegramMessage(botToken, chatId, formatTelegramMessage(trigger, rule));
    return { attempted: true, delivered: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Telegram delivery failed.';
    return { attempted: true, delivered: false, reason: message };
  }
}

export async function sendTelegramText(chatId: string, text: string) {
  const botToken = readEnv('TELEGRAM_BOT_TOKEN');
  if (!botToken || !chatId) return;
  await postTelegramMessage(botToken, chatId, text);
}
