import { BubblemapsClient } from '../../server/bubblemaps/client';
import { BubblemapsReportService } from '../../server/bubblemaps/report-service';
import { parseBubblemapsRequest } from '../../server/bubblemaps/validation';

const client = new BubblemapsClient();
const reports = new BubblemapsReportService(client);

const headers = {
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json; charset=utf-8'
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers });
}

function routePath(pathname: string) {
  return pathname
    .replace(/^\/api\/bubblemaps/, '')
    .replace(/^\/\.netlify\/functions\/bubblemaps/, '') || '/';
}

export default async function handler(request: Request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== 'GET') {
    return json(405, { error: 'Method not allowed.' });
  }

  const requestUrl = new URL(request.url);
  const path = routePath(requestUrl.pathname);

  if (path === '/health') {
    return json(200, {
      configured: client.configured,
      baseUrl: client.baseUrl,
      cacheEntries: client.cacheSize
    });
  }

  if (path === '/detect-network') {
    const address = requestUrl.searchParams.get('address')?.trim() || '';
    return json(200, await reports.detectNetwork(address));
  }

  if (path === '/report') {
    try {
      const { chain, address } = parseBubblemapsRequest(requestUrl.searchParams);
      return json(200, await reports.buildReport(chain, address));
    } catch (error) {
      return json(400, { error: error instanceof Error ? error.message : 'Invalid Bubblemaps request.' });
    }
  }

  return json(404, { error: 'Bubblemaps endpoint not found.' });
}
