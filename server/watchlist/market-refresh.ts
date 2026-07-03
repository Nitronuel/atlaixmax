import { getCoinGeckoCoin } from '../coingecko/database';
import { lookupSmartAlertToken } from '../smart-alerts/runner';
import type { WatchlistAssetInput, WatchlistAssetRow, WatchlistStore } from './store';

const MARKET_REFRESH_TTL_MS = 2 * 60 * 1000;

function numberOrNull(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function snapshotTimestamp(asset: WatchlistAssetRow) {
  const snapshot = asset.last_snapshot || {};
  const timestamps = [snapshot.marketRefreshedAt, snapshot.marketRefreshAttemptedAt]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));
  return timestamps.length ? Math.max(...timestamps) : 0;
}

function shouldRefreshAsset(asset: WatchlistAssetRow, force: boolean) {
  if (force) return true;
  const timestamp = snapshotTimestamp(asset);
  return !Number.isFinite(timestamp) || timestamp <= 0 || Date.now() - timestamp > MARKET_REFRESH_TTL_MS;
}

function mergeSnapshot(asset: WatchlistAssetRow, patch: Record<string, unknown>) {
  return {
    ...(asset.last_snapshot || {}),
    ...patch
  };
}

async function buildTokenPatch(asset: WatchlistAssetRow): Promise<Partial<WatchlistAssetInput> | null> {
  if (!asset.token_address) return null;

  const token = await lookupSmartAlertToken(asset.token_address, asset.chain_id || '', asset.pair_address || '');
  if (!token) return null;

  return {
    chainId: token.chainId || asset.chain_id,
    tokenAddress: token.address || asset.token_address,
    pairAddress: token.pairAddress || asset.pair_address,
    symbol: token.symbol || asset.symbol,
    name: token.name || asset.name,
    imageUrl: token.imageUrl ?? asset.image_url,
    priceUsd: token.priceUsd,
    priceChange24h: token.change24h,
    liquidityUsd: token.liquidityUsd,
    riskLevel: token.riskLevel ?? asset.risk_level,
    lastSnapshot: mergeSnapshot(asset, {
      marketRefreshedAt: new Date().toISOString(),
      marketSource: token.source || 'dexscreener',
      marketRefreshError: null,
      volume24hUsd: token.volume24h
    })
  };
}

async function buildCoinPatch(asset: WatchlistAssetRow): Promise<Partial<WatchlistAssetInput> | null> {
  if (!asset.coin_id) return null;

  const { coin } = await getCoinGeckoCoin(asset.coin_id);
  return {
    coinId: coin.id || asset.coin_id,
    symbol: coin.symbol || asset.symbol,
    name: coin.name || asset.name,
    imageUrl: coin.image ?? asset.image_url,
    priceUsd: numberOrNull(coin.priceUsd),
    priceChange24h: numberOrNull(coin.change24h),
    liquidityUsd: asset.liquidity_usd,
    state: coin.event || asset.state,
    lastSnapshot: mergeSnapshot(asset, {
      marketRefreshedAt: new Date().toISOString(),
      marketSource: 'coingecko',
      marketRefreshError: null,
      marketCapUsd: coin.marketCapUsd,
      volume24hUsd: coin.volume24hUsd
    })
  };
}

export async function refreshWatchlistAssetMarketData(
  store: WatchlistStore,
  asset: WatchlistAssetRow,
  userId: string,
  force = false
) {
  if (!shouldRefreshAsset(asset, force)) return asset;

  try {
    const patch = asset.asset_type === 'coin'
      ? await buildCoinPatch(asset)
      : await buildTokenPatch(asset);

    if (!patch) {
      return await store.updateAsset(asset.id, {
        lastSnapshot: mergeSnapshot(asset, {
          marketRefreshAttemptedAt: new Date().toISOString(),
          marketRefreshError: 'Market data was not available.'
        })
      }, userId);
    }

    return await store.updateAsset(asset.id, patch, userId);
  } catch (error) {
    return await store.updateAsset(asset.id, {
      lastSnapshot: mergeSnapshot(asset, {
        marketRefreshAttemptedAt: new Date().toISOString(),
        marketRefreshError: error instanceof Error ? error.message : 'Market refresh failed.'
      })
    }, userId).catch(() => asset);
  }
}

export async function refreshWatchlistMarketData(
  store: WatchlistStore,
  assets: WatchlistAssetRow[],
  userId: string,
  force = false
) {
  return Promise.all(assets.map((asset) => refreshWatchlistAssetMarketData(store, asset, userId, force)));
}
