import { apiUrl } from '../../config';
import { authSupabase } from '../../services/SupabaseClient';

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

export type InviteVerification = {
  fullName: string;
  email: string;
  inviteExpiresAt: string | null;
};

export type BetaApplicationInput = {
  fullName: string;
  email: string;
  xUsername?: string;
  telegramUsername?: string;
  intendedUse?: string;
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
  const response = await fetch(apiUrl(path), init);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : `Request failed with status ${response.status}.`);
  }
  return payload as T;
}

export const BetaApplicationService = {
  async submitApplication(input: BetaApplicationInput) {
    return requestJson<{ ok: true; message: string }>(`/api/beta-applications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    });
  },

  async listApplications(status?: BetaApplicationStatus | 'all') {
    const params = status && status !== 'all' ? `?${new URLSearchParams({ status }).toString()}` : '';
    const headers = await sessionHeaders();
    return requestJson<{ applications: BetaApplication[] }>(`/api/beta-applications/admin${params}`, { cache: 'no-store', headers });
  },

  async approve(id: string) {
    const headers = await sessionHeaders();
    return requestJson<{ application: BetaApplication; inviteUrl: string; email: { sent: boolean; reason?: string } }>(
      `/api/beta-applications/admin/${encodeURIComponent(id)}/approve`,
      { method: 'POST', headers }
    );
  },

  async reject(id: string) {
    const headers = await sessionHeaders();
    return requestJson<{ application: BetaApplication }>(
      `/api/beta-applications/admin/${encodeURIComponent(id)}/reject`,
      { method: 'POST', headers }
    );
  },

  async resend(id: string) {
    const headers = await sessionHeaders();
    return requestJson<{ application: BetaApplication; inviteUrl: string; email: { sent: boolean; reason?: string } }>(
      `/api/beta-applications/admin/${encodeURIComponent(id)}/resend`,
      { method: 'POST', headers }
    );
  },

  async delete(id: string) {
    const headers = await sessionHeaders();
    return requestJson<{ application: BetaApplication }>(
      `/api/beta-applications/admin/${encodeURIComponent(id)}`,
      { method: 'DELETE', headers }
    );
  },

  async verifyInvite(token: string) {
    const params = new URLSearchParams({ token });
    return requestJson<{ ok: true; application: InviteVerification }>(`/api/beta-applications/invite?${params.toString()}`);
  },

  async register(input: { token: string; displayName: string; password: string }) {
    return requestJson<{ ok: true }>(`/api/beta-applications/invite/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    });
  }
};
