import type { IncomingMessage, ServerResponse } from 'node:http';
import { requireAuthenticatedUser, type AuthenticatedUser } from '../auth';
import { readJsonBody } from '../http/body';
import { sendJson, sendNotFound } from '../http/response';
import {
  approveBetaApplication,
  createBetaApplication,
  listBetaApplications,
  registerInvitedUser,
  rejectBetaApplication,
  verifyInviteToken
} from './store';
import { readEnv } from '../env';

function statusForPublicError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (message.startsWith('Supabase beta application request failed') || message.includes('service role is not configured')) {
    return 503;
  }
  return 400;
}

async function getProfileRole(userId: string) {
  const url = readEnv('SUPABASE_URL', 'VITE_SUPABASE_URL').replace(/\/$/, '');
  const key = readEnv('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY');
  if (!url || !key) throw new Error('Supabase service role is not configured.');

  const params = new URLSearchParams({
    select: 'role',
    id: `eq.${userId}`,
    limit: '1'
  });
  const response = await fetch(`${url}/rest/v1/profiles?${params.toString()}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json'
    }
  });
  if (!response.ok) throw new Error('Admin role could not be verified.');

  const rows = await response.json().catch(() => []);
  return typeof rows?.[0]?.role === 'string' ? rows[0].role : 'user';
}

async function requireAdminUser(request: IncomingMessage): Promise<AuthenticatedUser> {
  const user = await requireAuthenticatedUser(request);
  const role = await getProfileRole(user.id);
  if (role !== 'admin') throw new Error('ADMIN_REQUIRED');
  return user;
}

function applicationIdFromPath(pathname: string, action: 'approve' | 'reject' | 'resend') {
  const match = new RegExp(`^/api/beta-applications/admin/([^/]+)/${action}$`).exec(pathname);
  return match ? decodeURIComponent(match[1]) : '';
}

export class BetaApplicationRoutes {
  async handle(request: IncomingMessage, response: ServerResponse, requestUrl: URL) {
    const method = (request.method || 'GET').toUpperCase();
    const pathname = requestUrl.pathname;

    if (method === 'POST' && pathname === '/api/beta-applications') {
      try {
        await createBetaApplication(await readJsonBody(request));
        sendJson(response, 200, { ok: true, message: 'Application received.' });
      } catch (error) {
        const status = statusForPublicError(error);
        sendJson(response, status, {
          error: status === 503
            ? 'Early access requests are temporarily unavailable.'
            : error instanceof Error ? error.message : 'Application could not be submitted.'
        });
      }
      return;
    }

    if (method === 'GET' && pathname === '/api/beta-applications/invite') {
      try {
        const application = await verifyInviteToken(requestUrl.searchParams.get('token') || '');
        sendJson(response, 200, {
          ok: true,
          application: {
            fullName: application.fullName,
            email: application.email,
            inviteExpiresAt: application.inviteExpiresAt
          }
        });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Invitation could not be verified.' });
      }
      return;
    }

    if (method === 'POST' && pathname === '/api/beta-applications/invite/register') {
      try {
        const result = await registerInvitedUser(await readJsonBody(request));
        sendJson(response, 200, { ok: true, ...result });
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : 'Account could not be created.' });
      }
      return;
    }

    if (method === 'GET' && pathname === '/api/beta-applications/admin') {
      await requireAdminUser(request);
      sendJson(response, 200, {
        applications: await listBetaApplications(requestUrl.searchParams.get('status') || '')
      });
      return;
    }

    const approveId = applicationIdFromPath(pathname, 'approve');
    if (method === 'POST' && approveId) {
      const admin = await requireAdminUser(request);
      sendJson(response, 200, await approveBetaApplication(approveId, admin.id));
      return;
    }

    const resendId = applicationIdFromPath(pathname, 'resend');
    if (method === 'POST' && resendId) {
      const admin = await requireAdminUser(request);
      sendJson(response, 200, await approveBetaApplication(resendId, admin.id, true));
      return;
    }

    const rejectId = applicationIdFromPath(pathname, 'reject');
    if (method === 'POST' && rejectId) {
      const admin = await requireAdminUser(request);
      sendJson(response, 200, { application: await rejectBetaApplication(rejectId, admin.id) });
      return;
    }

    sendNotFound(response);
  }
}
