import type { CoinGeckoCoin, CoinGeckoEvent } from '../../src/shared/coingecko';

export function classifyCoinEvent(coin: Pick<CoinGeckoCoin, 'marketCapRank' | 'volume24hUsd' | 'marketCapUsd' | 'change1h' | 'change24h' | 'change7d'>): CoinGeckoEvent {
  const rank = Number(coin.marketCapRank || 0);
  const volume = Number(coin.volume24hUsd || 0);
  const marketCap = Number(coin.marketCapUsd || 0);
  const change1h = Number(coin.change1h || 0);
  const change24h = Number(coin.change24h || 0);
  const change7d = Number(coin.change7d || 0);
  const volumeToCap = marketCap > 0 ? volume / marketCap : 0;

  if (rank > 0 && rank <= 20 && volume >= 500_000_000) return 'Market Leader';
  if (change24h >= 8 && change7d >= 12) return 'Strong Momentum';
  if (volumeToCap >= 0.18 && Math.abs(change24h) >= 3) return 'Volume Expansion';
  if (change7d < -8 && change24h > 2 && change1h >= 0) return 'Recovery Attempt';
  if (change24h <= -6 || (change1h <= -2 && change24h < 0)) return 'Sell Pressure';
  if (Math.abs(change24h) <= 1.5 && Math.abs(change7d) <= 4) return 'Range Cooling';
  return 'Unusual Activity';
}
