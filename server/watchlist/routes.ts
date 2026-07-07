import type { IncomingMessage, ServerResponse } from 'node:http';
import { requireAuthenticatedUser } from '../auth';
import { sendJson, sendNotFound } from '../http/response';
import { SmartAlertStore } from '../smart-alerts/store';
import { buildWatchlistActivity, buildWatchlistSummary, latestActivityByAsset } from './intelligence';
import { refreshWatchlistAssetMarketData, refreshWatchlistMarketData } from './market-refresh';
import { WatchlistStore } from './store';

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function parseLimit(value: string | null, fallback: number) {
  const limit = Number(value || fallback);
  return Number.isFinite(limit) ? Math.max(1, Math.min(100, limit)) : fallback;
}

export class WatchlistRoutes {
  readonly store = new WatchlistStore();

  constructor(private readonly smartAlertStore = new SmartAlertStore()) {}

  private async loadAssets(userId: string, refreshMarket = false) {
    const assets = await this.store.listAssets(userId);
    return refreshMarket ? refreshWatchlistMarketData(this.store, assets, userId) : assets;
  }

  private async loadActivity(userId: string, limit = 30, refreshMarket = false) {
    const assets = await this.loadAssets(userId, refreshMarket);
    const triggers = await this.smartAlertStore.listTriggers(100, userId).catch(() => []);
    return {
      assets,
      activity: await buildWatchlistActivity(assets, triggers, limit)
    };
  }

  async handle(request: IncomingMessage, response: ServerResponse, requestUrl: URL) {
    const method = (request.method || 'GET').toUpperCase();
    const pathname = requestUrl.pathname;

    if (method === 'GET' && pathname === '/api/watchlist/assets') {
      const user = await requireAuthenticatedUser(request);
      const assets = await this.loadAssets(user.id);
      void refreshWatchlistMarketData(this.store, assets, user.id).catch(() => undefined);
      sendJson(response, 200, { assets });
      return;
    }

    if (method === 'POST' && pathname === '/api/watchlist/assets') {
      const user = await requireAuthenticatedUser(request);
      const body = await readJsonBody(request);
      sendJson(response, 200, { asset: await this.store.createAsset(body, user.id) });
      return;
    }

    if (method === 'GET' && pathname === '/api/watchlist/summary') {
      const user = await requireAuthenticatedUser(request);
      const { assets, activity } = await this.loadActivity(user.id, 50);
      sendJson(response, 200, buildWatchlistSummary(assets, activity));
      return;
    }

    if (method === 'GET' && pathname === '/api/watchlist/activity') {
      const user = await requireAuthenticatedUser(request);
      const limit = parseLimit(requestUrl.searchParams.get('limit'), 30);
      const { activity } = await this.loadActivity(user.id, limit);
      sendJson(response, 200, { generatedAt: new Date().toISOString(), activity });
      return;
    }

    const assetMatch = pathname.match(/^\/api\/watchlist\/assets\/([^/]+)$/);
    if (assetMatch && method === 'PATCH') {
      const user = await requireAuthenticatedUser(request);
      const body = await readJsonBody(request);
      const asset = await this.store.updateAsset(decodeURIComponent(assetMatch[1]), body, user.id);
      sendJson(response, 200, { asset });
      return;
    }

    if (assetMatch && method === 'DELETE') {
      const user = await requireAuthenticatedUser(request);
      await this.store.deleteAsset(decodeURIComponent(assetMatch[1]), user.id);
      sendJson(response, 200, { deleted: true });
      return;
    }

    const refreshMatch = pathname.match(/^\/api\/watchlist\/assets\/([^/]+)\/refresh$/);
    if (refreshMatch && method === 'POST') {
      const user = await requireAuthenticatedUser(request);
      const { assets, activity } = await this.loadActivity(user.id, 50);
      const asset = assets.find((item) => item.id === decodeURIComponent(refreshMatch[1]));
      if (!asset) {
        sendJson(response, 404, { error: 'Watchlist asset was not found.' });
        return;
      }
      const refreshedAsset = await refreshWatchlistAssetMarketData(this.store, asset, user.id, true);
      const latest = latestActivityByAsset(activity).get(asset.id);
      const refreshed = latest
        ? await this.store.updateAsset(refreshedAsset.id, {
          state: latest.title,
          lastEventType: latest.title,
          lastEventAt: latest.createdAt
        }, user.id)
        : refreshedAsset;
      sendJson(response, 200, { asset: refreshed });
      return;
    }

    sendNotFound(response);
  }
}
