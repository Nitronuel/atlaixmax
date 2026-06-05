import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from '../http/response';
import { getOverviewFeed, searchOverviewTokens } from './database';

export class OverviewRoutes {
  async handle(request: IncomingMessage, response: ServerResponse, requestUrl: URL) {
    const method = (request.method || 'GET').toUpperCase();
    if (method !== 'GET') {
      sendJson(response, 405, { error: 'Method not allowed.' });
      return;
    }

    if (requestUrl.pathname === '/api/overview/feed') {
      sendJson(response, 200, await getOverviewFeed(requestUrl.searchParams.get('force') === '1'));
      return;
    }

    if (requestUrl.pathname === '/api/overview/search') {
      sendJson(response, 200, {
        generatedAt: new Date().toISOString(),
        tokens: await searchOverviewTokens(requestUrl.searchParams.get('q') || '')
      });
      return;
    }

    sendJson(response, 404, { error: 'Overview endpoint not found.' });
  }
}
