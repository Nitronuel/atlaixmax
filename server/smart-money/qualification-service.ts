import type { SavedWallet, WalletActivityItem, WalletActivityToken } from '../../src/features/wallet-tracker/wallet-types';
import { evaluateSmartMoneyWallet, type SmartMoneyEvidence, type SmartMoneyQualification } from '../../src/shared/smart-money-qualification';
import { WalletActivityService } from '../wallet/activity-service';

type TokenTradeState = {
  address?: string;
  symbol: string;
  boughtQty: number;
  soldQty: number;
  cost: number;
  proceeds: number;
  realizedCost: number;
  realizedPnl: number;
  completedTrades: number;
  wins: number;
  losses: number;
  grossProfit: number;
  grossLoss: number;
  largestProfit: number;
  firstActivityAt: number;
  lastActivityAt: number;
};

const STABLE_SYMBOLS = new Set(['USDC', 'USDT', 'DAI', 'USDE', 'FDUSD', 'USDS', 'TUSD']);
const activityService = new WalletActivityService();

function parseAmount(token: WalletActivityToken | undefined) {
  if (!token?.amount) return 0;
  const value = Number(token.amount.replace(/,/g, '').trim());
  return Number.isFinite(value) ? Math.abs(value) : 0;
}

function tokenKey(token: WalletActivityToken, chain: string) {
  return `${chain}:${token.address || token.symbol}`.toLowerCase();
}

function isStable(token: WalletActivityToken | undefined) {
  return token ? STABLE_SYMBOLS.has(token.symbol.toUpperCase()) : false;
}

function createTradeState(token: WalletActivityToken, timestamp: number): TokenTradeState {
  return {
    address: token.address,
    symbol: token.symbol,
    boughtQty: 0,
    soldQty: 0,
    cost: 0,
    proceeds: 0,
    realizedCost: 0,
    realizedPnl: 0,
    completedTrades: 0,
    wins: 0,
    losses: 0,
    grossProfit: 0,
    grossLoss: 0,
    largestProfit: 0,
    firstActivityAt: timestamp,
    lastActivityAt: timestamp
  };
}

function getState(states: Map<string, TokenTradeState>, token: WalletActivityToken, item: WalletActivityItem) {
  const key = tokenKey(token, item.chain);
  const state = states.get(key) || createTradeState(token, item.timestamp);
  state.firstActivityAt = Math.min(state.firstActivityAt || item.timestamp, item.timestamp);
  state.lastActivityAt = Math.max(state.lastActivityAt, item.timestamp);
  states.set(key, state);
  return state;
}

function recordBuy(states: Map<string, TokenTradeState>, item: WalletActivityItem, token: WalletActivityToken | undefined, usdValue: number) {
  if (!token || isStable(token) || usdValue <= 0) return;
  const state = getState(states, token, item);
  state.boughtQty += parseAmount(token);
  state.cost += usdValue;
}

function recordSell(states: Map<string, TokenTradeState>, item: WalletActivityItem, token: WalletActivityToken | undefined, usdValue: number) {
  if (!token || isStable(token) || usdValue <= 0) return;
  const state = getState(states, token, item);
  const soldQty = parseAmount(token);
  const openQty = Math.max(state.boughtQty - state.soldQty, 0);
  const averageCost = state.boughtQty > 0 ? state.cost / state.boughtQty : 0;
  const realizedCost = averageCost > 0 && soldQty > 0 ? averageCost * Math.min(soldQty, openQty || soldQty) : 0;
  const pnl = realizedCost > 0 ? usdValue - realizedCost : 0;

  state.soldQty += soldQty;
  state.proceeds += usdValue;
  if (realizedCost <= 0) return;

  state.realizedCost += realizedCost;
  state.realizedPnl += pnl;
  state.completedTrades += 1;
  if (pnl > 0) {
    state.wins += 1;
    state.grossProfit += pnl;
    state.largestProfit = Math.max(state.largestProfit, pnl);
  } else {
    state.losses += 1;
    state.grossLoss += Math.abs(pnl);
  }
}

function applyActivity(states: Map<string, TokenTradeState>, item: WalletActivityItem) {
  const value = item.usdValue || item.tokenIn?.usdValue || item.tokenOut?.usdValue || 0;
  if (value <= 0) return;

  if (item.kind === 'buy') recordBuy(states, item, item.tokenOut, value);
  if (item.kind === 'sell') recordSell(states, item, item.tokenIn, value);
  if (item.kind !== 'swap') return;

  if (isStable(item.tokenIn) && !isStable(item.tokenOut)) {
    recordBuy(states, item, item.tokenOut, value);
    return;
  }

  if (!isStable(item.tokenIn) && isStable(item.tokenOut)) {
    recordSell(states, item, item.tokenIn, value);
    return;
  }

  recordSell(states, item, item.tokenIn, value);
  recordBuy(states, item, item.tokenOut, value);
}

function sumWindow(states: TokenTradeState[], start: number) {
  return states.reduce((total, state) => state.lastActivityAt >= start ? total + state.realizedPnl : total, 0);
}

function buildEvidence(wallet: SavedWallet, activities: WalletActivityItem[]): SmartMoneyEvidence {
  const states = new Map<string, TokenTradeState>();
  activities.forEach((item) => applyActivity(states, item));
  const trades = [...states.values()];
  const completed = trades.filter((trade) => trade.completedTrades > 0);
  const firstActivityAt = activities.reduce((oldest, item) => Math.min(oldest, item.timestamp || oldest), Date.now());
  const now = Date.now();
  const realizedPnl = completed.reduce((total, trade) => total + trade.realizedPnl, 0);
  const grossProfit = completed.reduce((total, trade) => total + trade.grossProfit, 0);
  const grossLoss = completed.reduce((total, trade) => total + trade.grossLoss, 0);
  const wins = completed.reduce((total, trade) => total + trade.wins, 0);
  const completedTrades = completed.reduce((total, trade) => total + trade.completedTrades, 0);
  const severeLosses = completed.filter((trade) => trade.realizedCost > 0 && (trade.realizedPnl / trade.realizedCost) <= -0.8).length;
  const largestProfit = completed.reduce((largest, trade) => Math.max(largest, trade.largestProfit), 0);
  const recentCutoff = now - 30 * 86_400_000;
  const cutoff90d = now - 90 * 86_400_000;
  const realizedPnl90d = sumWindow(completed, cutoff90d);
  const realizedCost90d = completed.reduce((total, trade) => trade.lastActivityAt >= cutoff90d ? total + trade.realizedCost : total, 0);

  return {
    netWorthUsd: wallet.qualification?.metrics.netWorthUsd,
    completedTrades,
    uniqueTokens: trades.length,
    activeAgeDays: Math.floor((now - firstActivityAt) / 86_400_000),
    recentTrades30d: activities.filter((item) => item.timestamp >= recentCutoff && (item.kind === 'buy' || item.kind === 'sell' || item.kind === 'swap')).length,
    realizedPnl30d: sumWindow(completed, recentCutoff),
    realizedPnl90d,
    realizedRoi90d: realizedCost90d > 0 ? (realizedPnl90d / realizedCost90d) * 100 : 0,
    winRate: completedTrades > 0 ? (wins / completedTrades) * 100 : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0,
    rugExposureRate: completed.length ? severeLosses / completed.length : 0,
    severeLossRate: completed.length ? severeLosses / completed.length : 0,
    largestTradeProfitShare: grossProfit > 0 ? largestProfit / grossProfit : 0,
    activePositions: wallet.qualification?.metrics.activePositions,
    profitablePositions: wallet.qualification?.metrics.profitablePositions,
    pnlPercent: wallet.qualification?.metrics.pnlPercent
  };
}

export const SmartMoneyQualificationService = {
  async evaluateWallet(wallet: SavedWallet): Promise<SmartMoneyQualification> {
    const activity = await activityService.getActivity(wallet.addr, wallet.chain, {
      period: 'ALL',
      kind: 'all',
      limit: 250
    });

    if (activity.providerStatus === 'provider_missing' || activity.providerStatus === 'error') {
      return evaluateSmartMoneyWallet({
        netWorthUsd: wallet.qualification?.metrics.netWorthUsd,
        activePositions: wallet.qualification?.metrics.activePositions,
        profitablePositions: wallet.qualification?.metrics.profitablePositions,
        pnlPercent: wallet.qualification?.metrics.pnlPercent
      });
    }

    return evaluateSmartMoneyWallet(buildEvidence(wallet, activity.activities));
  }
};
