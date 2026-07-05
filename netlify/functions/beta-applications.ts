import { readEnv } from '../../server/env';
import {
  approveBetaApplication,
  createBetaApplication,
  deleteBetaApplication,
  listBetaApplications,
  registerInvitedUser,
  rejectBetaApplication,
  verifyInviteToken
} from '../../server/beta-applications/store';

const headers = {
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json; charset=utf-8'
};

type AuthenticatedUser = {
  id: string;
  email: string;
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers });
}

function routePath(pathname: string) {
  return pathname
    .replace(/^\/api\/beta-applications/, '')
    .replace(/^\/\.netlify\/functions\/beta-applications/, '') || '/';
}

async function readJson(request: Request) {
  const raw = await request.text();
  return raw ? JSON.parse(raw) : {};
}

function statusForPublicError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (message.startsWith('Supabase beta application request failed') || message.includes('service role is not configured')) {
    return 503;
  }
  return 400;
}

function getSupabasePublicConfig() {
  const url = readEnv('SUPABASE_URL', 'VITE_SUPABASE_URL').replace(/\/$/, '');
  const anonKey = readEnv('SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY');
  return { url, anonKey };
}

function getSupabaseServiceConfig() {
  const url = readEnv('SUPABASE_URL', 'VITE_SUPABASE_URL').replace(/\/$/, '');
  const key = readEnv('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY');
  return { url, key };
}

function getBearerToken(request: Request) {
  const header = request.headers.get('authorization') || '';
  return /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim() || '';
}

async function requireAuthenticatedUser(request: Request): Promise<AuthenticatedUser> {
  const token = getBearerToken(request);
  if (!token) throw new Error('AUTH_REQUIRED');

  const { url, anonKey } = getSupabasePublicConfig();
  if (!url || !anonKey) throw new Error('AUTH_NOT_CONFIGURED');

  const response = await fetch(`${url}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) throw new Error('AUTH_REQUIRED');
  const payload = await response.json().catch(() => null);
  const id = typeof payload?.id === 'string' ? payload.id : '';
  if (!id) throw new Error('AUTH_REQUIRED');

  return {
    id,
    email: typeof payload?.email === 'string' ? payload.email : ''
  };
}

async function getProfileRole(userId: string) {
  const { url, key } = getSupabaseServiceConfig();
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

async function requireAdminUser(request: Request) {
  const user = await requireAuthenticatedUser(request);
  const role = await getProfileRole(user.id);
  if (role !== 'admin') throw new Error('ADMIN_REQUIRED');
  return user;
}

function applicationIdFromPath(path: string, action: 'approve' | 'reject' | 'resend') {
  const match = new RegExp(`^/admin/([^/]+)/${action}$`).exec(path);
  return match ? decodeURIComponent(match[1]) : '';
}

function adminApplicationIdFromPath(path: string) {
  const match = /^\/admin\/([^/]+)$/.exec(path);
  return match ? decodeURIComponent(match[1]) : '';
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'Request failed.';
  if (message === 'AUTH_REQUIRED') return json(401, { error: 'Sign in required.' });
  if (message === 'AUTH_NOT_CONFIGURED') return json(503, { error: 'Authentication is not configured.' });
  if (message === 'ADMIN_REQUIRED') return json(403, { error: 'Admin access required.' });
  return json(400, { error: message });
}

export default async function handler(request: Request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  const method = request.method.toUpperCase();
  const requestUrl = new URL(request.url);
  const path = routePath(requestUrl.pathname);

  if (method === 'POST' && path === '/') {
    try {
      await createBetaApplication(await readJson(request));
      return json(200, { ok: true, message: 'Application received.' });
    } catch (error) {
      const status = statusForPublicError(error);
      return json(status, {
        error: status === 503
          ? 'Early access requests are temporarily unavailable.'
          : error instanceof Error ? error.message : 'Application could not be submitted.'
      });
    }
  }

  if (method === 'GET' && path === '/invite') {
    try {
      const application = await verifyInviteToken(requestUrl.searchParams.get('token') || '');
      return json(200, {
        ok: true,
        application: {
          fullName: application.fullName,
          email: application.email,
          inviteExpiresAt: application.inviteExpiresAt
        }
      });
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (method === 'POST' && path === '/invite/register') {
    try {
      const result = await registerInvitedUser(await readJson(request));
      return json(200, { ok: true, ...result });
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (method === 'GET' && path === '/admin') {
    try {
      await requireAdminUser(request);
      return json(200, {
        applications: await listBetaApplications(requestUrl.searchParams.get('status') || '')
      });
    } catch (error) {
      return errorResponse(error);
    }
  }

  const deleteId = adminApplicationIdFromPath(path);
  if (method === 'DELETE' && deleteId) {
    try {
      await requireAdminUser(request);
      return json(200, { application: await deleteBetaApplication(deleteId) });
    } catch (error) {
      return errorResponse(error);
    }
  }

  const approveId = applicationIdFromPath(path, 'approve');
  if (method === 'POST' && approveId) {
    try {
      const admin = await requireAdminUser(request);
      return json(200, await approveBetaApplication(approveId, admin.id));
    } catch (error) {
      return errorResponse(error);
    }
  }

  const resendId = applicationIdFromPath(path, 'resend');
  if (method === 'POST' && resendId) {
    try {
      const admin = await requireAdminUser(request);
      return json(200, await approveBetaApplication(resendId, admin.id, true));
    } catch (error) {
      return errorResponse(error);
    }
  }

  const rejectId = applicationIdFromPath(path, 'reject');
  if (method === 'POST' && rejectId) {
    try {
      const admin = await requireAdminUser(request);
      return json(200, { application: await rejectBetaApplication(rejectId, admin.id) });
    } catch (error) {
      return errorResponse(error);
    }
  }

  return json(404, { error: 'Beta application endpoint not found.' });
}
