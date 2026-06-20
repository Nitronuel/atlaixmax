import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from '../http/response';
import { BubblemapsClient } from './client';
import { BubblemapsReportService } from './report-service';
import { parseBubblemapsRequest } from './validation';

export class BubblemapsRoutes {
  private readonly client = new BubblemapsClient();
  private readonly reports = new BubblemapsReportService(this.client);

  async handle(request: IncomingMessage, response: ServerResponse, requestUrl: URL) {
    const method = (request.method || 'GET').toUpperCase();
    if (method !== 'GET') {
      sendJson(response, 405, { error: 'Method not allowed.' });
      return;
    }

    if (requestUrl.pathname === '/api/bubblemaps/health') {
      sendJson(response, 200, {
        configured: this.client.configured,
        baseUrl: this.client.baseUrl,
        cacheEntries: this.client.cacheSize
      });
      return;
    }

    if (requestUrl.pathname === '/api/bubblemaps/detect-network') {
      const address = requestUrl.searchParams.get('address')?.trim() || '';
      sendJson(response, 200, await this.reports.detectNetwork(address));
      return;
    }

    let parsed: ReturnType<typeof parseBubblemapsRequest>;
    try {
      parsed = parseBubblemapsRequest(requestUrl.searchParams);
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : 'Invalid Bubblemaps request.' });
      return;
    }

    if (requestUrl.pathname === '/api/bubblemaps/report') {
      sendJson(response, 200, await this.reports.buildReport(parsed.chain, parsed.address));
      return;
    }

    sendJson(response, 404, { error: 'Bubblemaps endpoint not found.' });
  }
}
