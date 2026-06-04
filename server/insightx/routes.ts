import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from '../http/response';
import { InsightXClient } from './client';
import { InsightXReportService } from './report-service';
import { parseInsightXRequest } from './validation';

export class InsightXRoutes {
  private readonly client = new InsightXClient();
  private readonly reports = new InsightXReportService(this.client);

  async handle(request: IncomingMessage, response: ServerResponse, requestUrl: URL) {
    const method = (request.method || 'GET').toUpperCase();
    if (method !== 'GET') {
      sendJson(response, 405, { error: 'Method not allowed.' });
      return;
    }

    if (requestUrl.pathname === '/api/insightx/health') {
      sendJson(response, 200, {
        configured: this.client.configured,
        baseUrl: this.client.baseUrl,
        cacheEntries: this.client.cacheSize
      });
      return;
    }

    let parsed: ReturnType<typeof parseInsightXRequest>;
    try {
      parsed = parseInsightXRequest(requestUrl.searchParams);
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : 'Invalid InsightX request.' });
      return;
    }

    if (requestUrl.pathname === '/api/insightx/report') {
      sendJson(response, 200, await this.reports.buildReport(parsed.network, parsed.address));
      return;
    }
    sendJson(response, 404, { error: 'InsightX endpoint not found.' });
  }
}
