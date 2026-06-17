import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from '../http/response';
import { getCoinGeckoChart, getCoinGeckoCoin, getCoinGeckoFeed, ingestCoinGeckoCoins, searchCoinGeckoCoins } from './database';

export class CoinGeckoRoutes {
  async handle(request: IncomingMessage, response: ServerResponse, requestUrl: URL) {
    const method = (request.method || 'GET').toUpperCase();

    if (requestUrl.pathname === '/api/coingecko/feed') {
      if (method !== 'GET') {
        sendJson(response, 405, { error: 'Method not allowed.' });
        return;
      }
      sendJson(response, 200, await getCoinGeckoFeed(requestUrl.searchParams.get('force') === '1'));
      return;
    }

    if (requestUrl.pathname === '/api/coingecko/search') {
      if (method !== 'GET') {
        sendJson(response, 405, { error: 'Method not allowed.' });
        return;
      }
      sendJson(response, 200, {
        generatedAt: new Date().toISOString(),
        coins: await searchCoinGeckoCoins(requestUrl.searchParams.get('q') || '')
      });
      return;
    }

    if (requestUrl.pathname === '/api/coingecko/ingest') {
      if (method !== 'POST') {
        sendJson(response, 405, { error: 'Method not allowed.' });
        return;
      }
      sendJson(response, 200, await ingestCoinGeckoCoins());
      return;
    }

    if (requestUrl.pathname === '/api/coingecko/coin') {
      if (method !== 'GET') {
        sendJson(response, 405, { error: 'Method not allowed.' });
        return;
      }
      sendJson(response, 200, await getCoinGeckoCoin(requestUrl.searchParams.get('id') || ''));
      return;
    }

    if (requestUrl.pathname === '/api/coingecko/chart') {
      if (method !== 'GET') {
        sendJson(response, 405, { error: 'Method not allowed.' });
        return;
      }
      sendJson(response, 200, await getCoinGeckoChart(
        requestUrl.searchParams.get('id') || '',
        Number(requestUrl.searchParams.get('days') || 7)
      ));
      return;
    }

    sendJson(response, 404, { error: 'CoinGecko endpoint not found.' });
  }
}
