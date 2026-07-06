import { apiUrl } from '../../config';
import { authSupabase } from '../../services/SupabaseClient';

export type FeedbackStatus = 'open' | 'waiting_admin' | 'waiting_user' | 'resolved';
export type FeedbackSenderRole = 'user' | 'admin';

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
  messages?: FeedbackMessage[];
};

export type FeedbackInput = {
  subject: string;
  category: string;
  message: string;
  sourcePath?: string | null;
  userName?: string | null;
};

async function sessionHeaders() {
  const { data } = authSupabase ? await authSupabase.auth.getSession() : { data: { session: null } };
  const accessToken = data.session?.access_token;
  return {
    'Content-Type': 'application/json',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
  };
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = await sessionHeaders();
  const response = await fetch(apiUrl(path), {
    ...init,
    headers: {
      ...headers,
      ...(init.headers || {})
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : `Request failed with status ${response.status}.`);
  }
  return payload as T;
}

export const FeedbackService = {
  async listThreads() {
    return requestJson<{ threads: FeedbackThread[] }>('/api/feedback/threads', { cache: 'no-store' });
  },

  async getThread(id: string) {
    return requestJson<{ thread: FeedbackThread }>(`/api/feedback/threads/${encodeURIComponent(id)}`, { cache: 'no-store' });
  },

  async createThread(input: FeedbackInput) {
    return requestJson<{ thread: FeedbackThread }>('/api/feedback/threads', {
      method: 'POST',
      body: JSON.stringify(input)
    });
  },

  async reply(threadId: string, message: string) {
    return requestJson<{ thread: FeedbackThread }>(`/api/feedback/threads/${encodeURIComponent(threadId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ message })
    });
  },

  async listAdminThreads() {
    return requestJson<{ threads: FeedbackThread[] }>('/api/feedback/admin/threads', { cache: 'no-store' });
  },

  async getAdminThread(id: string) {
    return requestJson<{ thread: FeedbackThread }>(`/api/feedback/admin/threads/${encodeURIComponent(id)}`, { cache: 'no-store' });
  },

  async replyAsAdmin(threadId: string, message: string) {
    return requestJson<{ thread: FeedbackThread }>(`/api/feedback/admin/threads/${encodeURIComponent(threadId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ message })
    });
  },

  async updateStatus(threadId: string, status: FeedbackStatus) {
    return requestJson<{ thread: FeedbackThread }>(`/api/feedback/admin/threads/${encodeURIComponent(threadId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
  }
};
