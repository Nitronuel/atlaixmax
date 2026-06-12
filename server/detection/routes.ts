import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, sendNotFound } from '../http/response';
import { DetectionRunner } from './runner';
import { DetectionStore, type DetectionEventFilters } from './store';

function parseLimit(value: string | null, fallback: number) {
  const parsed = Number(value || fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export class DetectionRoutes {
  readonly store = new DetectionStore();
  readonly runner = new DetectionRunner(this.store);

  start() {
    this.runner.start();
  }

  async handle(request: IncomingMessage, response: ServerResponse, requestUrl: URL) {
    const method = (request.method || 'GET').toUpperCase();
    const pathname = requestUrl.pathname;

    if (method === 'GET' && pathname === '/api/detection/events') {
      const filters: DetectionEventFilters = {
        q: requestUrl.searchParams.get('q') || undefined,
        chain: requestUrl.searchParams.get('chain') || undefined,
        severity: requestUrl.searchParams.get('severity') as DetectionEventFilters['severity'] || undefined,
        sentiment: requestUrl.searchParams.get('sentiment') as DetectionEventFilters['sentiment'] || undefined,
        limit: parseLimit(requestUrl.searchParams.get('limit'), 100)
      };
      sendJson(response, 200, await this.store.listEvents(filters));
      return;
    }

    if (method === 'GET' && pathname === '/api/detection/token') {
      const chain = requestUrl.searchParams.get('chain') || '';
      const address = requestUrl.searchParams.get('address') || '';
      const pair = requestUrl.searchParams.get('pair') || '';
      if (!chain.trim() || !address.trim()) {
        sendJson(response, 400, { error: 'Token chain and address are required.' });
        return;
      }
      sendJson(response, 200, await this.store.getTokenDetail(chain, address, pair));
      return;
    }

    if (method === 'POST' && pathname === '/api/detection/run') {
      sendJson(response, 200, await this.runner.runNow());
      return;
    }

    if (method === 'GET' && pathname === '/api/detection/status') {
      sendJson(response, 200, this.runner.getStatus());
      return;
    }

    sendNotFound(response);
  }
}
