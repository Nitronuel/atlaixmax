import type { IncomingMessage, ServerResponse } from 'node:http';
import { requireAuthenticatedUser } from '../auth';
import { sendJson, sendNotFound } from '../http/response';
import { lookupSmartAlertToken, SmartAlertRunner } from './runner';
import { SmartAlertStore } from './store';

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export class SmartAlertRoutes {
  readonly store = new SmartAlertStore();
  readonly runner = new SmartAlertRunner(this.store);

  start() {
    this.runner.start();
  }

  async handle(request: IncomingMessage, response: ServerResponse, requestUrl: URL) {
    const method = (request.method || 'GET').toUpperCase();
    const pathname = requestUrl.pathname;

    if (method === 'GET' && pathname === '/api/smart-alerts/status') {
      sendJson(response, 200, this.runner.getStatus());
      return;
    }

    if (method === 'POST' && pathname === '/api/smart-alerts/run') {
      sendJson(response, 200, await this.runner.runNow());
      return;
    }

    if (method === 'GET' && pathname === '/api/smart-alerts/token-lookup') {
      const address = requestUrl.searchParams.get('address') || '';
      const chain = requestUrl.searchParams.get('chain') || '';
      if (!address.trim()) {
        sendJson(response, 400, { error: 'Token address is required.' });
        return;
      }

      const token = await lookupSmartAlertToken(address, chain);
      if (!token) {
        sendJson(response, 404, { error: 'Token was not found.' });
        return;
      }

      sendJson(response, 200, { token });
      return;
    }

    if (method === 'GET' && pathname === '/api/smart-alerts/rules') {
      const user = await requireAuthenticatedUser(request);
      sendJson(response, 200, { rules: await this.store.listRules(user.id) });
      return;
    }

    if (method === 'POST' && pathname === '/api/smart-alerts/rules') {
      const user = await requireAuthenticatedUser(request);
      const body = await readJsonBody(request);
      const rule = await this.store.createRule(body, user.id);
      sendJson(response, 200, { rule });
      return;
    }

    const ruleMatch = pathname.match(/^\/api\/smart-alerts\/rules\/([^/]+)$/);
    if (ruleMatch && method === 'PATCH') {
      const user = await requireAuthenticatedUser(request);
      const body = await readJsonBody(request);
      const rule = await this.store.updateRule(decodeURIComponent(ruleMatch[1]), {
        enabled: Boolean(body.enabled),
        metadata: body.metadata
      }, user.id);
      sendJson(response, 200, { rule });
      return;
    }

    if (ruleMatch && method === 'DELETE') {
      const user = await requireAuthenticatedUser(request);
      await this.store.deleteRule(decodeURIComponent(ruleMatch[1]), user.id);
      sendJson(response, 200, { deleted: true });
      return;
    }

    if (method === 'GET' && pathname === '/api/smart-alerts/triggers') {
      const user = await requireAuthenticatedUser(request);
      const limit = Number(requestUrl.searchParams.get('limit') || 50);
      sendJson(response, 200, { triggers: await this.store.listTriggers(Number.isFinite(limit) ? limit : 50, user.id) });
      return;
    }

    sendNotFound(response);
  }
}
