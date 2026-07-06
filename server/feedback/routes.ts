import type { IncomingMessage, ServerResponse } from 'node:http';
import { requireAuthenticatedUser, type AuthenticatedUser } from '../auth';
import { readEnv } from '../env';
import { readJsonBody } from '../http/body';
import { sendJson, sendNotFound } from '../http/response';
import { FeedbackService } from './service';
import type { FeedbackStatus } from './store';

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

function threadIdFromPath(pathname: string, admin = false) {
  const pattern = admin
    ? /^\/api\/feedback\/admin\/threads\/([^/]+)$/
    : /^\/api\/feedback\/threads\/([^/]+)$/;
  const match = pattern.exec(pathname);
  return match ? decodeURIComponent(match[1]) : '';
}

function messageThreadIdFromPath(pathname: string, admin = false) {
  const pattern = admin
    ? /^\/api\/feedback\/admin\/threads\/([^/]+)\/messages$/
    : /^\/api\/feedback\/threads\/([^/]+)\/messages$/;
  const match = pattern.exec(pathname);
  return match ? decodeURIComponent(match[1]) : '';
}

function statusFromBody(value: unknown): FeedbackStatus {
  return value === 'resolved' || value === 'waiting_user' || value === 'waiting_admin' || value === 'open'
    ? value
    : 'open';
}

function sendRouteError(response: ServerResponse, error: unknown) {
  const message = error instanceof Error ? error.message : 'Feedback request failed.';
  const status = /not found/i.test(message) ? 404 : /required|valid|characters/i.test(message) ? 400 : 500;
  sendJson(response, status, { error: message });
}

export class FeedbackRoutes {
  constructor(private readonly service = new FeedbackService()) {}

  async handle(request: IncomingMessage, response: ServerResponse, requestUrl: URL) {
    const method = (request.method || 'GET').toUpperCase();
    const pathname = requestUrl.pathname;

    if (method === 'GET' && pathname === '/api/feedback/threads') {
      const user = await requireAuthenticatedUser(request);
      sendJson(response, 200, { threads: await this.service.listForUser(user.id) });
      return;
    }

    if (method === 'POST' && pathname === '/api/feedback/threads') {
      const user = await requireAuthenticatedUser(request);
      try {
        sendJson(response, 200, { thread: await this.service.createThread(user, await readJsonBody(request)) });
      } catch (error) {
        sendRouteError(response, error);
      }
      return;
    }

    if (method === 'GET' && pathname === '/api/feedback/admin/threads') {
      await requireAdminUser(request);
      sendJson(response, 200, { threads: await this.service.listForAdmin() });
      return;
    }

    const adminMessageThreadId = messageThreadIdFromPath(pathname, true);
    if (method === 'POST' && adminMessageThreadId) {
      const admin = await requireAdminUser(request);
      try {
        sendJson(response, 200, { thread: await this.service.replyAsAdmin(admin, adminMessageThreadId, await readJsonBody(request)) });
      } catch (error) {
        sendRouteError(response, error);
      }
      return;
    }

    const adminThreadId = threadIdFromPath(pathname, true);
    if (adminThreadId && method === 'GET') {
      await requireAdminUser(request);
      try {
        sendJson(response, 200, { thread: await this.service.getThreadForAdmin(adminThreadId) });
      } catch (error) {
        sendRouteError(response, error);
      }
      return;
    }

    if (adminThreadId && method === 'PATCH') {
      await requireAdminUser(request);
      try {
        const body = await readJsonBody(request);
        sendJson(response, 200, { thread: await this.service.updateStatus(adminThreadId, statusFromBody(body.status)) });
      } catch (error) {
        sendRouteError(response, error);
      }
      return;
    }

    const userMessageThreadId = messageThreadIdFromPath(pathname);
    if (method === 'POST' && userMessageThreadId) {
      const user = await requireAuthenticatedUser(request);
      try {
        sendJson(response, 200, { thread: await this.service.replyAsUser(user, userMessageThreadId, await readJsonBody(request)) });
      } catch (error) {
        sendRouteError(response, error);
      }
      return;
    }

    const userThreadId = threadIdFromPath(pathname);
    if (method === 'GET' && userThreadId) {
      const user = await requireAuthenticatedUser(request);
      try {
        sendJson(response, 200, { thread: await this.service.getThreadForUser(userThreadId, user.id) });
      } catch (error) {
        sendRouteError(response, error);
      }
      return;
    }

    sendNotFound(response);
  }
}
