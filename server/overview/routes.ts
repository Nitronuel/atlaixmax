import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from '../http/response';
import { getOverviewFeed, getOverviewTokenDetails, getOverviewTokenTrades, ingestOverviewTokens, searchOverviewTokens } from './database';

export class OverviewRoutes {
  async handle(request: IncomingMessage, response: ServerResponse, requestUrl: URL) {
    const method = (request.method || 'GET').toUpperCase();

    if (requestUrl.pathname === '/api/overview/feed') {
      if (method !== 'GET') {
        sendJson(response, 405, { error: 'Method not allowed.' });
        return;
      }
      sendJson(response, 200, await getOverviewFeed(requestUrl.searchParams.get('force') === '1'));
      return;
    }

    if (requestUrl.pathname === '/api/overview/search') {
      if (method !== 'GET') {
        sendJson(response, 405, { error: 'Method not allowed.' });
        return;
      }
      sendJson(response, 200, {
        generatedAt: new Date().toISOString(),
        tokens: await searchOverviewTokens(requestUrl.searchParams.get('q') || '')
      });
      return;
    }

    if (requestUrl.pathname === '/api/overview/ingest') {
      if (method !== 'POST') {
        sendJson(response, 405, { error: 'Method not allowed.' });
        return;
      }
      sendJson(response, 200, await ingestOverviewTokens(requestUrl.searchParams.get('force') === '1'));
      return;
    }

    if (requestUrl.pathname === '/api/overview/token') {
      if (method !== 'GET') {
        sendJson(response, 405, { error: 'Method not allowed.' });
        return;
      }
      sendJson(response, 200, await getOverviewTokenDetails(
        requestUrl.searchParams.get('address') || '',
        requestUrl.searchParams.get('chain') || '',
        requestUrl.searchParams.get('pair') || ''
      ));
      return;
    }

    if (requestUrl.pathname === '/api/overview/token/trades') {
      if (method !== 'GET') {
        sendJson(response, 405, { error: 'Method not allowed.' });
        return;
      }
      sendJson(response, 200, await getOverviewTokenTrades(
        requestUrl.searchParams.get('address') || '',
        requestUrl.searchParams.get('chain') || '',
        requestUrl.searchParams.get('pair') || ''
      ));
      return;
    }

    sendJson(response, 404, { error: 'Overview endpoint not found.' });
  }
}
