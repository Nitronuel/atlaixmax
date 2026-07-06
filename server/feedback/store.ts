import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { readEnv } from '../env';

export type FeedbackStatus = 'open' | 'waiting_admin' | 'waiting_user' | 'resolved';
export type FeedbackSenderRole = 'user' | 'admin';

export type FeedbackThread = {
  id: string;
  user_id: string;
  user_email: string;
  user_name: string;
  subject: string;
  category: string;
  status: FeedbackStatus;
  source_path: string | null;
  last_message_at: string;
  created_at: string;
  updated_at: string;
};

export type FeedbackMessage = {
  id: string;
  thread_id: string;
  sender_id: string;
  sender_role: FeedbackSenderRole;
  sender_email: string;
  message: string;
  email_sent_at: string | null;
  email_error: string | null;
  created_at: string;
};

export type FeedbackThreadWithMessages = FeedbackThread & {
  messages: FeedbackMessage[];
};

type LocalFeedbackState = {
  threads: FeedbackThread[];
  messages: FeedbackMessage[];
};

type CreateThreadInput = {
  userId: string;
  userEmail: string;
  userName: string;
  subject: string;
  category: string;
  sourcePath?: string | null;
};

type CreateMessageInput = {
  threadId: string;
  senderId: string;
  senderRole: FeedbackSenderRole;
  senderEmail: string;
  message: string;
};

const THREAD_COLUMNS = 'id,user_id,user_email,user_name,subject,category,status,source_path,last_message_at,created_at,updated_at';
const MESSAGE_COLUMNS = 'id,thread_id,sender_id,sender_role,sender_email,message,email_sent_at,email_error,created_at';
const VALID_STATUSES = new Set<FeedbackStatus>(['open', 'waiting_admin', 'waiting_user', 'resolved']);

function getSupabaseConfig() {
  const url = readEnv('SUPABASE_URL', 'VITE_SUPABASE_URL').replace(/\/$/, '');
  const key = readEnv('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY');
  return { url, key };
}

function hasSupabaseConfig() {
  const { url, key } = getSupabaseConfig();
  return Boolean(url && key);
}

async function supabaseFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) throw new Error('Supabase service role is not configured for feedback.');

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
    throw new Error(`Supabase feedback request failed (${response.status}). ${message}`.trim());
  }

  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

function localPath() {
  return resolve(process.cwd(), '.data', 'feedback.json');
}

function readLocalState(): LocalFeedbackState {
  const filepath = localPath();
  if (!existsSync(filepath)) return { threads: [], messages: [] };
  try {
    const parsed = JSON.parse(readFileSync(filepath, 'utf8')) as LocalFeedbackState;
    return {
      threads: Array.isArray(parsed.threads) ? parsed.threads : [],
      messages: Array.isArray(parsed.messages) ? parsed.messages : []
    };
  } catch {
    return { threads: [], messages: [] };
  }
}

function writeLocalState(state: LocalFeedbackState) {
  const filepath = localPath();
  mkdirSync(dirname(filepath), { recursive: true });
  writeFileSync(filepath, JSON.stringify(state, null, 2));
}

function normalizeStatus(value: unknown, fallback: FeedbackStatus = 'open') {
  return VALID_STATUSES.has(value as FeedbackStatus) ? value as FeedbackStatus : fallback;
}

function normalizeThread(row: any): FeedbackThread {
  const now = new Date().toISOString();
  return {
    id: String(row.id || randomUUID()),
    user_id: String(row.user_id || ''),
    user_email: String(row.user_email || ''),
    user_name: String(row.user_name || row.user_email || 'Atlaix User'),
    subject: String(row.subject || 'Feedback'),
    category: String(row.category || 'General'),
    status: normalizeStatus(row.status),
    source_path: row.source_path || null,
    last_message_at: row.last_message_at || row.updated_at || now,
    created_at: row.created_at || now,
    updated_at: row.updated_at || now
  };
}

function normalizeMessage(row: any): FeedbackMessage {
  return {
    id: String(row.id || randomUUID()),
    thread_id: String(row.thread_id || ''),
    sender_id: String(row.sender_id || ''),
    sender_role: row.sender_role === 'admin' ? 'admin' : 'user',
    sender_email: String(row.sender_email || ''),
    message: String(row.message || ''),
    email_sent_at: row.email_sent_at || null,
    email_error: row.email_error || null,
    created_at: row.created_at || new Date().toISOString()
  };
}

function threadSort(left: FeedbackThread, right: FeedbackThread) {
  return right.last_message_at.localeCompare(left.last_message_at);
}

export class FeedbackStore {
  private useLocalOnly = false;

  async createThread(input: CreateThreadInput) {
    const now = new Date().toISOString();
    const row = normalizeThread({
      id: randomUUID(),
      user_id: input.userId,
      user_email: input.userEmail,
      user_name: input.userName,
      subject: input.subject,
      category: input.category,
      status: 'waiting_admin',
      source_path: input.sourcePath || null,
      last_message_at: now,
      created_at: now,
      updated_at: now
    });

    if (!this.useLocalOnly) {
      try {
        const rows = await supabaseFetch<any[]>(`feedback_threads?select=${encodeURIComponent(THREAD_COLUMNS)}`, {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(row)
        });
        return normalizeThread(rows[0]);
      } catch (error) {
        if (hasSupabaseConfig()) throw error;
        this.useLocalOnly = true;
      }
    }

    const state = readLocalState();
    state.threads.unshift(row);
    writeLocalState(state);
    return row;
  }

  async createMessage(input: CreateMessageInput) {
    const now = new Date().toISOString();
    const row = normalizeMessage({
      id: randomUUID(),
      thread_id: input.threadId,
      sender_id: input.senderId,
      sender_role: input.senderRole,
      sender_email: input.senderEmail,
      message: input.message,
      created_at: now
    });

    if (!this.useLocalOnly) {
      try {
        const rows = await supabaseFetch<any[]>(`feedback_messages?select=${encodeURIComponent(MESSAGE_COLUMNS)}`, {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(row)
        });
        const message = normalizeMessage(rows[0]);
        await this.touchThread(input.threadId, input.senderRole === 'admin' ? 'waiting_user' : 'waiting_admin', now);
        return message;
      } catch (error) {
        if (hasSupabaseConfig()) throw error;
        this.useLocalOnly = true;
      }
    }

    const state = readLocalState();
    state.messages.push(row);
    const index = state.threads.findIndex((thread) => thread.id === input.threadId);
    if (index >= 0) {
      state.threads[index] = {
        ...state.threads[index],
        status: input.senderRole === 'admin' ? 'waiting_user' : 'waiting_admin',
        last_message_at: now,
        updated_at: now
      };
    }
    writeLocalState(state);
    return row;
  }

  async updateMessageEmail(id: string, delivery: { sent: boolean; reason?: string }) {
    const patch = {
      email_sent_at: delivery.sent ? new Date().toISOString() : null,
      email_error: delivery.sent ? null : delivery.reason || 'Email could not be sent.'
    };

    if (!this.useLocalOnly) {
      try {
        const params = new URLSearchParams({ id: `eq.${id}` });
        await supabaseFetch(`feedback_messages?${params.toString()}`, {
          method: 'PATCH',
          body: JSON.stringify(patch)
        });
        return;
      } catch (error) {
        if (hasSupabaseConfig()) throw error;
        this.useLocalOnly = true;
      }
    }

    const state = readLocalState();
    const index = state.messages.findIndex((message) => message.id === id);
    if (index >= 0) state.messages[index] = { ...state.messages[index], ...patch };
    writeLocalState(state);
  }

  async listThreads(userId?: string, limit = 100) {
    if (!this.useLocalOnly) {
      try {
        const params = new URLSearchParams({
          select: THREAD_COLUMNS,
          order: 'last_message_at.desc',
          limit: String(limit)
        });
        if (userId) params.set('user_id', `eq.${userId}`);
        const rows = await supabaseFetch<any[]>(`feedback_threads?${params.toString()}`);
        return rows.map(normalizeThread);
      } catch (error) {
        if (hasSupabaseConfig()) throw error;
        this.useLocalOnly = true;
      }
    }

    return readLocalState().threads
      .map(normalizeThread)
      .filter((thread) => !userId || thread.user_id === userId)
      .sort(threadSort)
      .slice(0, limit);
  }

  async getThread(id: string, userId?: string) {
    const thread = (await this.listThreads(userId, 500)).find((candidate) => candidate.id === id) || null;
    if (!thread) return null;
    return {
      ...thread,
      messages: await this.listMessages(id)
    };
  }

  async updateThreadStatus(id: string, status: FeedbackStatus) {
    const nextStatus = normalizeStatus(status);
    const patch = { status: nextStatus, updated_at: new Date().toISOString() };

    if (!this.useLocalOnly) {
      try {
        const params = new URLSearchParams({
          id: `eq.${id}`,
          select: THREAD_COLUMNS
        });
        const rows = await supabaseFetch<any[]>(`feedback_threads?${params.toString()}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(patch)
        });
        return normalizeThread(rows[0]);
      } catch (error) {
        if (hasSupabaseConfig()) throw error;
        this.useLocalOnly = true;
      }
    }

    const state = readLocalState();
    const index = state.threads.findIndex((thread) => thread.id === id);
    if (index < 0) throw new Error('Feedback thread was not found.');
    state.threads[index] = { ...state.threads[index], ...patch };
    writeLocalState(state);
    return normalizeThread(state.threads[index]);
  }

  private async listMessages(threadId: string) {
    if (!this.useLocalOnly) {
      try {
        const params = new URLSearchParams({
          select: MESSAGE_COLUMNS,
          thread_id: `eq.${threadId}`,
          order: 'created_at.asc'
        });
        const rows = await supabaseFetch<any[]>(`feedback_messages?${params.toString()}`);
        return rows.map(normalizeMessage);
      } catch (error) {
        if (hasSupabaseConfig()) throw error;
        this.useLocalOnly = true;
      }
    }

    return readLocalState().messages
      .map(normalizeMessage)
      .filter((message) => message.thread_id === threadId)
      .sort((left, right) => left.created_at.localeCompare(right.created_at));
  }

  private async touchThread(id: string, status: FeedbackStatus, at: string) {
    const patch = { status, last_message_at: at, updated_at: at };
    const params = new URLSearchParams({ id: `eq.${id}` });
    await supabaseFetch(`feedback_threads?${params.toString()}`, {
      method: 'PATCH',
      body: JSON.stringify(patch)
    });
  }
}
