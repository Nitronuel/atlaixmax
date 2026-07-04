import type {
  WalletActivity,
  WalletActivityItem,
  WalletActivityKind,
  WalletActivitySummary,
  WalletActivityToken,
  WalletAsset,
  WalletChain,
  WalletPnlSummary,
  WalletPortfolio,
  WalletTradePerformance
} from '../../src/features/wallet-tracker/wallet-types';

type AnyRecord = Record<string, unknown>;

type ZerionPart = {
  data: unknown;
  status: number;
  error?: string;
};

type RecentTokenFlowSummary = {
  id?: string;
  address?: string;
  symbol: string;
  logo?: string;
  boughtQty: number;
  soldQty: number;
  cost: number;
  proceeds: number;
  earliestBuyAt?: number;
  lastActivityAt: number;
  flowCount: number;
  valuedFlowCount: number;
  realizedPnl?: number;
  remainingKnownQty: number;
  remainingKnownCost: number;
  missingBuyQty: number;
  missingSellQty: number;
  hasMissingBasis: boolean;
  hasTransferBaseline: boolean;
  hasHistoricalPrice: boolean;
  receivedValue: number;
  sentValue: number;
};

type TransactionTransferFlow = {
  row: AnyRecord;
  direction: 'in' | 'out';
  id?: string;
  address?: string;
  symbol: string;
  logo?: string;
  quantity: number;
  value?: number;
};

type TokenLot = {
  quantity: number;
  remainingQuantity: number;
  cost: number;
  timestamp: number;
  source: 'swap' | 'transfer' | 'paired_transfer' | 'historical_price';
};

type LedgerState = RecentTokenFlowSummary & {
  lots: TokenLot[];
};

type DerivedPositionPerformance = {
  pnl?: WalletTradePerformance;
  buyTime?: number;
  performanceStatus: WalletAsset['performanceStatus'];
  timeHeldStatus: WalletAsset['timeHeldStatus'];
  totalPnl?: number;
  totalReturnPct?: number;
  openCostBasisUsd?: number;
  openReturnPct?: number;
  costBasisUsd?: number;
  proceedsUsd?: number;
  pnlSource?: WalletAsset['pnlSource'];
  pnlConfidence?: WalletAsset['pnlConfidence'];
};

export type ZerionIntelligenceResponse = {
  address: string;
  period: string;
  generatedAt: string;
  portfolio?: ZerionPart;
  positions?: ZerionPart;
  pnl?: ZerionPart;
  transactions?: ZerionPart;
};

export type HistoricalPriceRequest = {
  key: string;
  chainId: string;
  address: string;
  symbol: string;
  timestamp: number;
};

export type NormalizerOptions = {
  historicalPrices?: Map<string, number>;
};

const CHAIN_LABELS: Record<string, WalletChain | string> = {
  ethereum: 'Ethereum',
  solana: 'Solana',
  base: 'Base',
  'binance-smart-chain': 'BSC',
  bsc: 'BSC',
  arbitrum: 'Arbitrum',
  optimism: 'Optimism',
  polygon: 'Polygon',
  avalanche: 'Avalanche'
};

const STABLECOIN_SYMBOLS = new Set(['USDC', 'USDT', 'DAI', 'PYUSD', 'FDUSD', 'USDE', 'USDS']);

function isStablecoinSymbol(value: unknown) {
  return STABLECOIN_SYMBOLS.has(firstString(value).toUpperCase());
}

function record(value: unknown): AnyRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : {};
}

function attrs(value: unknown): AnyRecord {
  const row = record(value);
  return record(row.attributes).constructor === Object && Object.keys(record(row.attributes)).length ? record(row.attributes) : row;
}

function dataArray(value: unknown) {
  const data = record(value).data;
  if (Array.isArray(data)) return data;
  return data ? [data] : [];
}

function includedMap(value: unknown) {
  const map = new Map<string, AnyRecord>();
  const included = record(value).included;
  if (!Array.isArray(included)) return map;
  included.forEach((item) => {
    const row = record(item);
    const id = String(row.id || '');
    const type = String(row.type || '');
    if (!id) return;
    map.set(id, row);
    if (type) map.set(`${type}:${id}`, row);
  });
  return map;
}

function related(resource: unknown, name: string, map: Map<string, AnyRecord>) {
  const data = record(record(record(resource).relationships)[name]).data;
  if (!data || Array.isArray(data)) return null;
  const row = record(data);
  const id = String(row.id || '');
  const type = String(row.type || '');
  return map.get(`${type}:${id}`) || map.get(id) || null;
}

function relationshipData(resource: unknown, name: string) {
  return record(record(record(resource).relationships)[name]).data;
}

function deepGet(value: unknown, path: string[]) {
  return path.reduce<unknown>((current, key) => record(current)[key], value);
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const next = numberValue(value);
    if (next !== undefined) return next;
  }
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/[$,%\s,]/g, ''));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (value && typeof value === 'object') {
    return firstNumber(
      record(value).float,
      record(value).numeric,
      record(value).value,
      record(value).amount,
      record(value).usd,
      record(value).last
    );
  }
  return undefined;
}

function formatUsd(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return 'N/A';
  if (value === 0) return '$0';
  if (value > 0 && value < 0.01) {
    const decimals = Math.min(12, Math.max(2, Math.ceil(-Math.log10(value)) + 1));
    const formatted = value.toFixed(decimals).replace(/0+$/u, '').replace(/\.$/u, '');
    return `$${formatted}`;
  }
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: value >= 1 ? 0 : 2 });
}

function formatSignedUsd(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return 'N/A';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${formatUsd(Math.abs(value))}`;
}

function formatPercent(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatAmount(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return 'N/A';
  if (Math.abs(value) >= 1_000_000) return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
  if (Math.abs(value) >= 1) return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(value);
  return value.toLocaleString('en-US', { maximumSignificantDigits: 6 });
}

function chainLabel(value: unknown) {
  const id = firstString(value).toLowerCase();
  return CHAIN_LABELS[id] || firstString(value) || 'Unknown';
}

function iconUrl(value: unknown) {
  return firstString(
    deepGet(value, ['icon', 'url']),
    deepGet(value, ['icon', 'small']),
    deepGet(value, ['icon', 'large']),
    record(value).icon_url,
    record(value).icon
  );
}

function implementationAddress(fungibleAttrs: AnyRecord, chainId: string) {
  const implementations = fungibleAttrs.implementations;
  if (!Array.isArray(implementations)) return '';
  const preferred = implementations.find((item) => firstString(record(item).chain_id, record(item).chain).toLowerCase() === chainId.toLowerCase());
  const row = record(preferred || implementations[0]);
  return firstString(row.address, row.contract_address);
}

function tokenKeys(...values: unknown[]) {
  return values
    .map((value) => firstString(value).toLowerCase())
    .filter(Boolean);
}

function indexToken<T>(map: Map<string, T>, value: T, ...keys: unknown[]) {
  tokenKeys(...keys).forEach((key) => map.set(key, value));
}

export function historicalPriceKey(chainId: string, address: string, timestamp: number) {
  const day = Math.floor(timestamp / 86_400_000);
  return `${chainId.toLowerCase()}:${address.toLowerCase()}:${day}`;
}

function quantityValue(value: unknown) {
  return firstNumber(
    deepGet(value, ['quantity', 'float']),
    deepGet(value, ['quantity', 'numeric']),
    deepGet(value, ['quantity', 'value']),
    record(value).quantity
  );
}

function positionValue(value: unknown) {
  return firstNumber(record(value).value, deepGet(value, ['value', 'value']), deepGet(value, ['value', 'usd']));
}

function transferUsdValue(value: unknown) {
  const row = record(value);
  const quantity = Math.abs(quantityValue(row) || 0);
  const fungibleAttrs = attrs(transferFungible(row));
  const symbol = firstString(fungibleAttrs.symbol, row.symbol).toUpperCase();
  const price = firstNumber(row.price, deepGet(row, ['price', 'value']), deepGet(row, ['price', 'usd']));
  return firstNumber(
    row.value,
    deepGet(row, ['value', 'value']),
    deepGet(row, ['value', 'usd']),
    price !== undefined && quantity ? price * quantity : undefined,
    isStablecoinSymbol(symbol) && quantity ? quantity : undefined
  );
}

function positionPrice(value: unknown, fungibleAttrs: AnyRecord) {
  return firstNumber(
    record(value).price,
    deepGet(value, ['price', 'value']),
    deepGet(value, ['price', 'last']),
    deepGet(fungibleAttrs, ['market_data', 'price']),
    deepGet(fungibleAttrs, ['market_data', 'price', 'value'])
  );
}

function isDisplayablePosition(value: unknown) {
  const flags = record(attrs(value).flags);
  return flags.is_trash !== true && flags.displayable !== false;
}

function pnlTotal(row: AnyRecord) {
  return firstNumber(
    row.total_gain,
    row.total_pnl,
    row.pnl,
    row.gain,
    row.realized_gain
  );
}

function pnlReturn(row: AnyRecord) {
  return firstNumber(
    row.relative_total_gain_percentage,
    row.relative_gain,
    row.total_gain_percent,
    row.roi
  );
}

function pnlInvested(row: AnyRecord) {
  return firstNumber(row.total_invested, row.net_invested, row.invested, row.cost_basis);
}

function pnlStatus(row: AnyRecord): WalletTradePerformance['status'] {
  const realizedPnl = firstNumber(row.realized_gain, row.realized_pnl);
  const unrealizedPnl = firstNumber(row.unrealized_gain, row.unrealized_pnl);
  const netInvested = firstNumber(row.net_invested);
  const totalInvested = firstNumber(row.total_invested, row.invested, row.cost_basis);

  if (unrealizedPnl !== undefined && Math.abs(unrealizedPnl) > 0.01) {
    return realizedPnl !== undefined && Math.abs(realizedPnl) > 0.01 ? 'Partial' : 'Open position';
  }

  if (netInvested !== undefined && Math.abs(netInvested) > 0.01) return 'Open position';
  if (realizedPnl !== undefined || totalInvested !== undefined) return 'Closed';
  return 'No priced basis';
}

function shortTokenAddress(value: string) {
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

function tokenFromPnlKey(key: string) {
  const [chain, ...addressParts] = key.split(':');
  const address = addressParts.join(':');
  if (address) {
    return {
      address,
      symbol: `${chain}:${shortTokenAddress(address)}`
    };
  }

  return {
    symbol: key.toUpperCase()
  };
}

function normalizeBreakdownRows(summaryRow: AnyRecord): WalletTradePerformance[] {
  const breakdown = record(summaryRow.breakdown);
  const rows: WalletTradePerformance[] = [];

  Object.entries(record(breakdown.by_id)).forEach(([key, value]) => {
    const row = record(value);
    rows.push({
      id: key,
      token: tokenFromPnlKey(key),
      realizedPnl: firstNumber(row.realized_gain, row.realized_pnl),
      unrealizedPnl: firstNumber(row.unrealized_gain, row.unrealized_pnl),
      totalPnl: pnlTotal(row),
      returnPct: pnlReturn(row),
      invested: pnlInvested(row),
      valueLabel: 'PnL',
      valuationSource: 'zerion',
      valuationConfidence: 'high',
      status: pnlStatus(row)
    });
  });

  Object.entries(record(breakdown.by_implementation)).forEach(([key, value]) => {
    const address = key.split(':').slice(1).join(':');
    if (rows.some((row) => row.id === key || row.token.address === address)) return;

    const row = record(value);
    rows.push({
      id: key,
      token: tokenFromPnlKey(key),
      realizedPnl: firstNumber(row.realized_gain, row.realized_pnl),
      unrealizedPnl: firstNumber(row.unrealized_gain, row.unrealized_pnl),
      totalPnl: pnlTotal(row),
      returnPct: pnlReturn(row),
      invested: pnlInvested(row),
      valueLabel: 'PnL',
      valuationSource: 'zerion',
      valuationConfidence: 'high',
      status: pnlStatus(row)
    });
  });

  return rows;
}

function normalizePortfolioOverview(raw: unknown) {
  const resource = dataArray(raw)[0] || record(raw).data || raw;
  const row = attrs(resource);
  const netWorth = firstNumber(
    deepGet(row, ['total', 'positions']),
    row.total,
    row.value,
    row.total_value,
    row.market_value,
    row.net_worth
  ) || 0;
  const change24h = firstNumber(
    deepGet(row, ['changes', 'absolute_1d']),
    deepGet(row, ['changes', 'percent_1d']),
    row.change_24h
  );

  const chainDistribution = Object.entries(record(row.positions_distribution_by_chain || row.chain_distribution || row.chains)).map(([chain, value]) => ({
    chain: chainLabel(chain),
    value: numberValue(value) || 0
  }));

  const positionDistribution = Object.entries(record(row.positions_distribution_by_type || row.position_distribution || row.types)).map(([type, value]) => ({
    type,
    value: numberValue(value) || 0
  }));

  return {
    netWorth,
    change24h,
    chainDistribution,
    positionDistribution
  };
}

function collectPnlRows(raw: unknown) {
  const rows: AnyRecord[] = [];

  function visit(value: unknown) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    const row = record(value);
    const candidate = attrs(row);
    const hasPnl = ['realized_gain', 'unrealized_gain', 'total_gain', 'net_invested', 'total_fee', 'pnl', 'roi'].some((key) => key in candidate);
    if (hasPnl) rows.push({ ...candidate, __resource: row });
    Object.values(row).forEach(visit);
  }

  visit(raw);
  return rows;
}

function normalizePnl(raw: unknown): { summary?: WalletPnlSummary; rows: WalletTradePerformance[]; byToken: Map<string, WalletTradePerformance> } {
  const allRows = collectPnlRows(raw);
  const summaryRow = allRows.find((row) => !record(row.__resource).relationships) || attrs(dataArray(raw)[0]);
  const summary: WalletPnlSummary | undefined = summaryRow && Object.keys(summaryRow).length ? {
    totalGain: firstNumber(summaryRow.total_gain, summaryRow.total_pnl, summaryRow.pnl, summaryRow.gain) || 0,
    totalGainPercent: pnlReturn(summaryRow),
    realizedGain: firstNumber(summaryRow.realized_gain, summaryRow.realized_pnl) || 0,
    unrealizedGain: firstNumber(summaryRow.unrealized_gain, summaryRow.unrealized_pnl) || 0,
    netInvested: firstNumber(summaryRow.net_invested, summaryRow.invested, summaryRow.cost_basis) || 0,
    totalFee: firstNumber(summaryRow.total_fee, summaryRow.fees) || 0,
    receivedExternal: firstNumber(summaryRow.received_external),
    sentExternal: firstNumber(summaryRow.sent_external)
  } : undefined;

  const included = includedMap(raw);
  const byToken = new Map<string, WalletTradePerformance>();
  const rows = allRows
    .map((row, index): WalletTradePerformance | null => {
      const resource = record(row.__resource);
      const fungible = related(resource, 'fungible', included) || record(row.fungible_info) || record(row.fungible);
      const fungibleAttrs = attrs(fungible);
      const tokenId = firstString(record(fungible).id, row.fungible_id, row.id, row.symbol);
      const symbol = firstString(fungibleAttrs.symbol, row.symbol, 'TOKEN');
      const realizedPnl = firstNumber(row.realized_gain, row.realized_pnl);
      const unrealizedPnl = firstNumber(row.unrealized_gain, row.unrealized_pnl);
      const totalPnl = pnlTotal(row);
      const returnPct = pnlReturn(row);
      const invested = pnlInvested(row);
      if (!tokenId && symbol === 'TOKEN') return null;
      if (tokenId === firstString(record(dataArray(raw)[0]).id) && symbol === 'TOKEN') return null;

      return {
        id: tokenId || `${symbol}:${index}`,
        token: {
          address: implementationAddress(fungibleAttrs, ''),
          symbol,
          logo: iconUrl(fungibleAttrs)
        },
        realizedPnl,
        unrealizedPnl,
        totalPnl,
        returnPct,
        invested,
        valueLabel: 'PnL',
        valuationSource: 'zerion',
        valuationConfidence: 'high',
        status: pnlStatus(row)
      };
    })
    .filter((row): row is WalletTradePerformance => Boolean(row));

  normalizeBreakdownRows(summaryRow).forEach((row) => {
    if (rows.some((existing) => existing.id === row.id || existing.token.address === row.token.address || existing.token.symbol === row.token.symbol)) return;
    rows.push(row);
  });

  rows.forEach((row) => {
    indexToken(byToken, row, row.id, row.token.address, row.token.symbol);
  });

  return { summary, rows, byToken };
}

function transferDirection(value: unknown): 'in' | 'out' | undefined {
  const row = record(value);
  const direction = firstString(row.direction, row.type).toLowerCase();
  if (direction === 'in' || direction === 'incoming' || direction === 'receive' || direction === 'received') return 'in';
  if (direction === 'out' || direction === 'outgoing' || direction === 'send' || direction === 'sent') return 'out';

  const quantity = quantityValue(row);
  if (quantity !== undefined && quantity < 0) return 'out';
  if (quantity !== undefined && quantity > 0) return 'in';
  return undefined;
}

function transferFungible(value: unknown) {
  const row = record(value);
  return record(row.fungible_info || row.fungible);
}

function transferTokenAddress(value: unknown, chainId: string) {
  const row = record(value);
  const fungible = transferFungible(row);
  return firstString(
    implementationAddress(attrs(fungible), chainId),
    row.address,
    row.contract_address,
    record(fungible).id
  );
}

function transactionTransferFlows(transfers: unknown[], chainId: string) {
  return transfers.map((transfer): TransactionTransferFlow | null => {
    const transferRow = record(transfer);
    const direction = transferDirection(transferRow);
    if (!direction) return null;

    const fungible = transferFungible(transferRow);
    const fungibleAttrs = attrs(fungible);
    const symbol = firstString(fungibleAttrs.symbol, transferRow.symbol);
    const quantity = Math.abs(quantityValue(transferRow) || 0);
    if (!symbol || !quantity) return null;

    return {
      row: transferRow,
      direction,
      id: firstString(record(fungible).id, transferRow.fungible_id),
      address: transferTokenAddress(transferRow, chainId),
      symbol,
      logo: iconUrl(fungibleAttrs),
      quantity,
      value: transferUsdValue(transferRow)
    };
  }).filter((flow): flow is TransactionTransferFlow => Boolean(flow));
}

function fallbackPairedValue(flow: TransactionTransferFlow, flows: TransactionTransferFlow[]) {
  if (flow.value !== undefined && flow.value > 0) return flow.value;

  const oppositeDirection = flow.direction === 'in' ? 'out' : 'in';
  const oppositeValue = flows
    .filter((item) => item.direction === oppositeDirection)
    .reduce((total, item) => total + (item.value || 0), 0);
  if (!oppositeValue) return undefined;

  const unvaluedSameDirection = flows.filter((item) => item.direction === flow.direction && (!item.value || item.value <= 0));
  if (unvaluedSameDirection.length === 1) return oppositeValue;

  const totalQuantity = unvaluedSameDirection.reduce((total, item) => total + item.quantity, 0);
  if (!totalQuantity) return undefined;
  return oppositeValue * (flow.quantity / totalQuantity);
}

function resolvedFlowValue(flow: TransactionTransferFlow, flows: TransactionTransferFlow[], chainId: string, timestamp: number, options?: NormalizerOptions) {
  if (flow.value !== undefined && flow.value > 0) {
    return {
      value: flow.value,
      source: flowSource(flow, flows)
    };
  }

  const pairedValue = fallbackPairedValue(flow, flows);
  if (pairedValue !== undefined && pairedValue > 0) {
    return {
      value: pairedValue,
      source: 'paired_transfer' as const
    };
  }

  const price = flow.address && timestamp ? options?.historicalPrices?.get(historicalPriceKey(chainId, flow.address, timestamp)) : undefined;
  if (price !== undefined && price > 0) {
    return {
      value: price * flow.quantity,
      source: 'historical_price' as const
    };
  }

  return {
    value: undefined,
    source: undefined
  };
}

function transactionTimestamp(value: unknown) {
  const row = attrs(value);
  return Date.parse(firstString(row.mined_at, row.timestamp, row.created_at)) || 0;
}

function flowSource(flow: TransactionTransferFlow, flows: TransactionTransferFlow[]): TokenLot['source'] {
  return flows.some((item) => item.direction !== flow.direction) ? 'swap' : 'transfer';
}

function emptyLedger(flow: TransactionTransferFlow, id: string, address: string, logo?: string): LedgerState {
  return {
    id,
    address,
    symbol: flow.symbol,
    logo,
    boughtQty: 0,
    soldQty: 0,
    cost: 0,
    proceeds: 0,
    earliestBuyAt: undefined,
    lastActivityAt: 0,
    flowCount: 0,
    valuedFlowCount: 0,
    realizedPnl: undefined,
    remainingKnownQty: 0,
    remainingKnownCost: 0,
    missingBuyQty: 0,
    missingSellQty: 0,
    hasMissingBasis: false,
    hasTransferBaseline: false,
    hasHistoricalPrice: false,
    receivedValue: 0,
    sentValue: 0,
    lots: []
  };
}

function consumeLots(ledger: LedgerState, quantity: number, proceeds?: number) {
  let remainingQuantity = quantity;
  let matchedCost = 0;
  let matchedQuantity = 0;

  for (const lot of ledger.lots) {
    if (remainingQuantity <= 0) break;
    if (lot.remainingQuantity <= 0) continue;

    const consumed = Math.min(lot.remainingQuantity, remainingQuantity);
    const cost = lot.cost * (consumed / lot.quantity);
    lot.remainingQuantity -= consumed;
    remainingQuantity -= consumed;
    matchedQuantity += consumed;
    matchedCost += cost;
  }

  if (remainingQuantity > 1e-12) {
    ledger.missingSellQty += remainingQuantity;
    ledger.hasMissingBasis = true;
  }

  if (proceeds !== undefined && proceeds > 0 && matchedQuantity > 0) {
    const matchedProceeds = proceeds * (matchedQuantity / quantity);
    ledger.realizedPnl = (ledger.realizedPnl || 0) + matchedProceeds - matchedCost;
  }
}

function finalizeLedger(ledger: LedgerState): RecentTokenFlowSummary {
  const remainingKnownQty = ledger.lots.reduce((total, lot) => total + lot.remainingQuantity, 0);
  const remainingKnownCost = ledger.lots.reduce((total, lot) => total + (lot.cost * (lot.remainingQuantity / lot.quantity)), 0);
  return {
    ...ledger,
    remainingKnownQty,
    remainingKnownCost
  };
}

export function collectHistoricalPriceRequests(raw: unknown) {
  const requests = new Map<string, HistoricalPriceRequest>();

  dataArray(raw).forEach((transaction) => {
    const row = attrs(transaction);
    const timestamp = transactionTimestamp(transaction);
    const chainId = firstString(row.chain_id, row.chain);
    if (!timestamp || !chainId) return;

    const transfers = Array.isArray(row.transfers) ? row.transfers : Array.isArray(row.changes) ? row.changes : [];
    const transferFlows = transactionTransferFlows(transfers, chainId);
    transferFlows.forEach((flow) => {
      if (isStablecoinSymbol(flow.symbol) || !flow.address) return;
      if (fallbackPairedValue(flow, transferFlows) !== undefined) return;

      const key = historicalPriceKey(chainId, flow.address, timestamp);
      if (!requests.has(key)) {
        requests.set(key, {
          key,
          chainId,
          address: flow.address,
          symbol: flow.symbol,
          timestamp
        });
      }
    });
  });

  return [...requests.values()];
}

function deriveRecentTokenFlows(raw: unknown, options?: NormalizerOptions) {
  const groups = new Map<string, LedgerState>();

  dataArray(raw).slice().sort((a, b) => transactionTimestamp(a) - transactionTimestamp(b)).forEach((transaction) => {
    const row = attrs(transaction);
    const timestamp = transactionTimestamp(transaction);
    const chainId = firstString(row.chain_id, row.chain);
    const transfers = Array.isArray(row.transfers) ? row.transfers : Array.isArray(row.changes) ? row.changes : [];
    const transferFlows = transactionTransferFlows(transfers, chainId);

    transferFlows.forEach((flow) => {
      if (isStablecoinSymbol(flow.symbol)) return;

      const id = firstString(flow.id);
      const address = firstString(flow.address);
      const key = firstString(address, id, flow.symbol).toLowerCase();
      if (!key) return;

      const current = groups.get(key) || emptyLedger(flow, id, address, flow.logo);

      const { value, source } = resolvedFlowValue(flow, transferFlows, chainId, timestamp, options);
      current.flowCount += 1;
      current.valuedFlowCount += value !== undefined && value > 0 ? 1 : 0;
      current.lastActivityAt = Math.max(current.lastActivityAt, timestamp);
      current.hasHistoricalPrice = current.hasHistoricalPrice || source === 'historical_price';

      if (flow.direction === 'in') {
        current.boughtQty += flow.quantity;
        current.receivedValue += value || 0;
        current.earliestBuyAt = current.earliestBuyAt ? Math.min(current.earliestBuyAt, timestamp || current.earliestBuyAt) : timestamp || undefined;
        if (value !== undefined && value > 0) {
          current.cost += value;
          current.hasTransferBaseline = current.hasTransferBaseline || source === 'transfer';
          current.lots.push({
            quantity: flow.quantity,
            remainingQuantity: flow.quantity,
            cost: value,
            timestamp,
            source: source || flowSource(flow, transferFlows)
          });
        } else {
          current.missingBuyQty += flow.quantity;
          current.hasMissingBasis = true;
        }
      } else {
        current.soldQty += flow.quantity;
        current.sentValue += value || 0;
        current.proceeds += value || 0;
        consumeLots(current, flow.quantity, value);
      }

      groups.set(key, current);
    });
  });

  const byToken = new Map<string, RecentTokenFlowSummary>();
  groups.forEach((summary) => {
    const finalized = finalizeLedger(summary);
    indexToken(byToken, finalized, finalized.id, finalized.address, finalized.symbol);
  });
  return byToken;
}

function derivePositionPerformance(asset: Pick<WalletAsset, 'address' | 'rawBalance' | 'rawValue' | 'symbol' | 'logo'>, flow?: RecentTokenFlowSummary): DerivedPositionPerformance {
  if (!flow) {
    return {
      performanceStatus: 'unknown',
      timeHeldStatus: 'unknown',
      pnlSource: 'missing_basis',
      pnlConfidence: 'low'
    };
  }

  const timeHeldStatus: WalletAsset['timeHeldStatus'] = flow.earliestBuyAt ? 'partial_history' : 'unknown';
  const baseToken = {
    address: asset.address || flow.address,
      symbol: asset.symbol || flow.symbol,
      logo: asset.logo || flow.logo
  };

  const reportedBalance = typeof asset.rawBalance === 'number' && Number.isFinite(asset.rawBalance) ? Math.max(0, asset.rawBalance) : undefined;
  const remainingKnownQty = Math.max(0, flow.remainingKnownQty);
  const remainingKnownCost = Math.max(0, flow.remainingKnownCost);
  const hasKnownCost = flow.cost > 0 || remainingKnownCost > 0 || flow.realizedPnl !== undefined;
  const hasReportedBalance = (reportedBalance || 0) > 0;
  const hasCurrentQuote = asset.rawValue > 0;
  const missingStatus: WalletTradePerformance['status'] = hasReportedBalance && !hasCurrentQuote ? 'No USD quote' : flow.valuedFlowCount ? 'Cost basis missing' : 'No priced basis';
  const missingPerformanceStatus: WalletAsset['performanceStatus'] = missingStatus === 'No USD quote'
    ? 'no_price_quote'
    : missingStatus === 'No priced basis'
      ? 'unpriced_transfer'
      : 'cost_basis_missing';

  if (!hasKnownCost || (!remainingKnownCost && !flow.realizedPnl && hasReportedBalance)) {
    return {
      pnl: {
        id: firstString(flow.address, flow.id, flow.symbol),
        token: baseToken,
        valueUsd: asset.rawValue > 0 ? asset.rawValue : flow.receivedValue || flow.sentValue || flow.proceeds || undefined,
        valueLabel: asset.rawValue > 0 ? 'Value' : flow.receivedValue > 0 ? 'Received' : flow.sentValue > 0 ? 'Sent' : flow.proceeds > 0 ? 'Proceeds' : undefined,
        valuationSource: asset.rawValue > 0 ? 'current_value' : flow.hasHistoricalPrice ? 'historical_price' : flow.valuedFlowCount ? 'transfer_value' : undefined,
        valuationConfidence: asset.rawValue > 0 ? 'medium' : flow.hasHistoricalPrice ? 'medium' : flow.valuedFlowCount ? 'low' : undefined,
        status: missingStatus
      },
      buyTime: flow.earliestBuyAt,
      performanceStatus: missingPerformanceStatus,
      timeHeldStatus,
      totalPnl: undefined,
      totalReturnPct: undefined,
      openCostBasisUsd: remainingKnownCost || undefined,
      openReturnPct: undefined,
      costBasisUsd: remainingKnownCost || undefined,
      proceedsUsd: flow.proceeds || undefined,
      pnlSource: flow.hasHistoricalPrice ? 'historical_price' : 'missing_basis',
      pnlConfidence: 'low'
    };
  }

  const knownBalanceShare = reportedBalance && remainingKnownQty > 0 ? Math.min(1, remainingKnownQty / reportedBalance) : remainingKnownQty > 0 ? 1 : 0;
  const knownCurrentValue = asset.rawValue > 0 ? asset.rawValue * knownBalanceShare : 0;
  const realizedPnl = flow.realizedPnl;
  const unrealizedPnl = remainingKnownCost > 0 || knownCurrentValue > 0 ? knownCurrentValue - remainingKnownCost : undefined;
  const totalPnl = (realizedPnl || 0) + (unrealizedPnl || 0);
  const returnBasis = Math.max(flow.cost, remainingKnownCost);
  const totalReturnPct = returnBasis > 0 ? (totalPnl / returnBasis) * 100 : undefined;
  const openReturnPct = remainingKnownCost > 0 && unrealizedPnl !== undefined ? (unrealizedPnl / remainingKnownCost) * 100 : undefined;
  const partial = flow.hasMissingBasis || flow.missingBuyQty > 0 || flow.missingSellQty > 0;

  return {
    pnl: {
      id: firstString(flow.address, flow.id, flow.symbol),
      token: baseToken,
      realizedPnl,
      unrealizedPnl,
      totalPnl,
      returnPct: totalReturnPct,
      invested: remainingKnownCost || flow.cost,
      realizedCostBasis: Math.max(0, flow.cost - remainingKnownCost),
      openCostBasis: remainingKnownCost,
      valueUsd: totalPnl !== undefined ? undefined : remainingKnownCost || flow.receivedValue || undefined,
      valueLabel: totalPnl !== undefined ? undefined : flow.hasTransferBaseline ? 'Received' : 'Cost basis',
      valuationSource: flow.hasHistoricalPrice ? 'historical_price' : flow.hasTransferBaseline ? 'transfer_value' : 'fifo',
      valuationConfidence: flow.hasHistoricalPrice || partial ? 'medium' : 'high',
      status: partial ? 'Partial' : reportedBalance && reportedBalance > 0 ? 'Open position' : 'Closed'
    },
    buyTime: flow.earliestBuyAt,
    performanceStatus: partial ? 'partial_history' : 'reported',
    timeHeldStatus: partial ? timeHeldStatus : flow.earliestBuyAt ? 'reported' : timeHeldStatus,
    totalPnl,
    totalReturnPct,
    openCostBasisUsd: remainingKnownCost,
    openReturnPct,
    costBasisUsd: remainingKnownCost || flow.cost,
    proceedsUsd: flow.proceeds || undefined,
    pnlSource: flow.hasHistoricalPrice ? 'historical_price' : flow.hasTransferBaseline ? 'transfer_baseline' : 'fifo',
    pnlConfidence: partial ? 'medium' : 'high'
  };
}

function enrichTradePerformanceRows(rows: WalletTradePerformance[], recentFlows: Map<string, RecentTokenFlowSummary>) {
  return rows.map((row) => {
    const flow = recentFlows.get(row.id.toLowerCase())
      || recentFlows.get(String(row.token.address || '').toLowerCase())
      || recentFlows.get(row.token.symbol.toLowerCase());
    if (!flow) return row;

    return {
      ...row,
      token: {
        address: row.token.address || flow.address,
        symbol: flow.symbol || row.token.symbol,
        logo: row.token.logo || flow.logo
      }
    };
  });
}

function deriveHistoryPerformanceRows(recentFlows: Map<string, RecentTokenFlowSummary>, assets: WalletAsset[], pnlRows: WalletTradePerformance[]) {
  const existingKeys = new Set<string>();
  assets.forEach((asset) => {
    tokenKeys(asset.id, asset.address, asset.symbol).forEach((key) => existingKeys.add(key));
  });
  pnlRows.forEach((row) => {
    tokenKeys(row.id, row.token.address, row.token.symbol).forEach((key) => existingKeys.add(key));
  });

  const rows: WalletTradePerformance[] = [];
  const seenFlows = new Set<RecentTokenFlowSummary>();
  recentFlows.forEach((flow) => {
    if (seenFlows.has(flow)) return;
    seenFlows.add(flow);
    if (tokenKeys(flow.id, flow.address, flow.symbol).some((key) => existingKeys.has(key))) return;

    const id = firstString(flow.address, flow.id, flow.symbol);
    const token = {
      address: flow.address,
      symbol: flow.symbol,
      logo: flow.logo
    };

    if (!flow.cost || !flow.valuedFlowCount || flow.hasMissingBasis && flow.realizedPnl === undefined) {
      const status: WalletTradePerformance['status'] = flow.proceeds > 0
        ? 'Cost basis missing'
        : flow.boughtQty > 0 && !flow.valuedFlowCount
          ? 'No priced basis'
          : 'Open position';

      rows.push({
        id,
        token,
        valueUsd: flow.proceeds || flow.sentValue || flow.receivedValue || undefined,
        valueLabel: flow.proceeds > 0 ? 'Proceeds' : flow.sentValue > 0 ? 'Sent' : flow.receivedValue > 0 ? 'Received' : undefined,
        valuationSource: flow.hasHistoricalPrice ? 'historical_price' : flow.valuedFlowCount ? 'transfer_value' : undefined,
        valuationConfidence: flow.hasHistoricalPrice ? 'medium' : flow.valuedFlowCount ? 'low' : undefined,
        status
      });
      return;
    }

    const realizedPnl = flow.realizedPnl;
    const totalPnl = realizedPnl;
    const returnPct = realizedPnl !== undefined && flow.cost > 0 ? (realizedPnl / flow.cost) * 100 : undefined;

    rows.push({
      id,
      token,
      realizedPnl,
      totalPnl,
      returnPct,
      invested: flow.cost,
      valueUsd: realizedPnl === undefined ? flow.cost || flow.receivedValue || undefined : undefined,
      valueLabel: realizedPnl === undefined ? flow.hasTransferBaseline ? 'Received' : 'Cost basis' : undefined,
      valuationSource: flow.hasHistoricalPrice ? 'historical_price' : flow.hasTransferBaseline ? 'transfer_value' : 'fifo',
      valuationConfidence: flow.hasHistoricalPrice || flow.hasMissingBasis ? 'medium' : 'high',
      status: flow.hasMissingBasis ? 'Partial' : flow.remainingKnownQty <= 1e-12 ? 'Closed' : 'Open position'
    });
  });

  return rows;
}

function normalizePositions(raw: unknown, pnlByToken: Map<string, WalletTradePerformance>, recentFlows: Map<string, RecentTokenFlowSummary>) {
  const included = includedMap(raw);
  return dataArray(raw).filter(isDisplayablePosition).map((position): WalletAsset => {
    const row = attrs(position);
    const chain = related(position, 'chain', included);
    const chainId = firstString(record(chain).id, record(relationshipData(position, 'chain')).id, row.chain_id, row.chain);
    const fungible = related(position, 'fungible', included) || record(row.fungible_info) || record(row.fungible);
    const fungibleAttrs = attrs(fungible);
    const symbol = firstString(fungibleAttrs.symbol, row.symbol, 'TOKEN');
    const isStablecoin = isStablecoinSymbol(symbol);
    const address = firstString(implementationAddress(fungibleAttrs, chainId), row.address, record(position).id, symbol);
    const pnl = pnlByToken.get(String(record(fungible).id || '').toLowerCase())
      || pnlByToken.get(address.toLowerCase())
      || pnlByToken.get(symbol.toLowerCase());
    const recentFlow = recentFlows.get(String(record(fungible).id || '').toLowerCase())
      || recentFlows.get(address.toLowerCase())
      || recentFlows.get(symbol.toLowerCase());
    const value = positionValue(row) || 0;
    const price = positionPrice(row, fungibleAttrs) || 0;
    const balance = quantityValue(row);
    const derived = derivePositionPerformance({
      address,
      rawBalance: balance,
      rawValue: value,
      symbol,
      logo: iconUrl(fungibleAttrs)
    }, recentFlow);
    const positionPnl = isStablecoin ? {
      id: firstString(record(position).id, record(fungible).id, address),
      token: {
        address,
        symbol,
        logo: iconUrl(fungibleAttrs)
      },
      realizedPnl: 0,
      unrealizedPnl: 0,
      totalPnl: 0,
      returnPct: 0,
      invested: value,
      realizedCostBasis: 0,
      openCostBasis: value,
      status: 'Open position' as const
    } : pnl || derived.pnl;
    const reportedOpenCostBasis = positionPnl?.openCostBasis ?? positionPnl?.invested;
    const openPnl = isStablecoin ? 0 : positionPnl?.unrealizedPnl;
    const openReturnPct = isStablecoin ? 0 : derived.openReturnPct ?? (openPnl !== undefined && reportedOpenCostBasis && reportedOpenCostBasis > 0 ? (openPnl / reportedOpenCostBasis) * 100 : undefined);
    const totalPnl = isStablecoin ? 0 : derived.totalPnl ?? positionPnl?.totalPnl ?? positionPnl?.realizedPnl ?? undefined;
    const totalReturnPct = isStablecoin ? 0 : derived.totalReturnPct ?? positionPnl?.returnPct;

    return {
      id: firstString(record(position).id, record(fungible).id, address),
      symbol,
      name: firstString(fungibleAttrs.name, row.name, symbol),
      address,
      balance: formatAmount(balance),
      value: formatUsd(value),
      price: price ? formatUsd(price) : 'N/A',
      currentPrice: price,
      rawValue: value,
      rawBalance: balance,
      logo: iconUrl(fungibleAttrs),
      chain: chainLabel(chainId) as WalletChain,
      positionType: firstString(row.position_type, row.type, row.category, 'wallet'),
      dapp: firstString(deepGet(row, ['application_metadata', 'name']), deepGet(row, ['dapp', 'name'])),
      change24h: formatPercent(firstNumber(deepGet(row, ['changes', 'percent_1d']), row.percent_change_1d)),
      isStablecoin,
      pnl: openPnl !== undefined ? formatSignedUsd(openPnl) : undefined,
      pnlPercent: openReturnPct,
      realizedPnl: positionPnl?.realizedPnl,
      unrealizedPnl: openPnl,
      totalPnl,
      totalReturnPct,
      openCostBasisUsd: isStablecoin ? value : derived.openCostBasisUsd ?? reportedOpenCostBasis,
      openReturnPct,
      costBasisUsd: isStablecoin ? value : derived.costBasisUsd,
      proceedsUsd: isStablecoin ? undefined : derived.proceedsUsd,
      pnlSource: isStablecoin ? 'stablecoin' : pnl ? 'zerion' : derived.pnlSource,
      pnlConfidence: isStablecoin ? 'high' : pnl ? 'high' : derived.pnlConfidence,
      buyTime: derived.buyTime,
      performanceStatus: isStablecoin ? 'reported' : pnl ? 'reported' : derived.performanceStatus,
      timeHeldStatus: derived.timeHeldStatus
    };
  });
}

function normalizeKind(kind: string): WalletActivityKind {
  const value = kind.toLowerCase();
  if (value.includes('trade') || value.includes('swap')) return 'swap';
  if (value.includes('receive')) return 'receive';
  if (value.includes('send')) return 'send';
  if (value.includes('approve')) return 'approval';
  if (value.includes('deposit')) return 'receive';
  if (value.includes('withdraw')) return 'send';
  if (value.includes('buy')) return 'buy';
  if (value.includes('sell')) return 'sell';
  if (value.includes('contract')) return 'contract';
  return 'unknown';
}

function normalizeTransferToken(value: unknown): WalletActivityToken | null {
  const row = record(value);
  const fungible = transferFungible(row);
  const fungibleAttrs = attrs(fungible);
  const symbol = firstString(fungibleAttrs.symbol, row.symbol);
  if (!symbol) return null;
  const amount = quantityValue(row);
  return {
    address: transferTokenAddress(row, ''),
    symbol,
    name: firstString(fungibleAttrs.name, row.name),
    amount: amount !== undefined ? formatAmount(Math.abs(amount)) : undefined,
    usdValue: transferUsdValue(row),
    logo: iconUrl(fungibleAttrs)
  };
}

function normalizeTransactions(raw: unknown): WalletActivity {
  const activities = dataArray(raw).map((transaction): WalletActivityItem => {
    const row = attrs(transaction);
    const hash = firstString(row.hash, row.transaction_hash, record(transaction).id);
    const operation = firstString(row.operation_type, row.type, row.kind, 'transaction');
    const kind = normalizeKind(operation);
    const timestamp = Date.parse(firstString(row.mined_at, row.timestamp, row.created_at)) || 0;
    const transfers = Array.isArray(row.transfers) ? row.transfers : Array.isArray(row.changes) ? row.changes : [];
    const tokens = transfers.map(normalizeTransferToken).filter((token): token is WalletActivityToken => Boolean(token));
    const outgoing = transfers.find((transfer) => transferDirection(transfer) === 'out');
    const incoming = transfers.find((transfer) => transferDirection(transfer) === 'in');
    const chain = chainLabel(firstString(row.chain_id, row.chain)) as WalletChain;
    const value = firstNumber(row.value, deepGet(row, ['value', 'value']), tokens.reduce((total, token) => total + (token.usdValue || 0), 0));
    const tokenIn = outgoing ? normalizeTransferToken(outgoing) || undefined : undefined;
    const tokenOut = incoming ? normalizeTransferToken(incoming) || undefined : undefined;

    return {
      id: hash || String(record(transaction).id || `${operation}:${timestamp}`),
      hash,
      chain,
      kind,
      timestamp,
      title: operation.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
      summary: firstString(row.description, row.summary, tokens.length ? tokens.map((token) => token.symbol).join(' / ') : 'Wallet transaction'),
      tokenIn,
      tokenOut,
      tokens,
      usdValue: value,
      protocol: firstString(deepGet(row, ['application_metadata', 'name']), deepGet(row, ['dapp', 'name'])),
      explorerUrl: firstString(row.transaction_url, row.explorer_url, hash ? `https://etherscan.io/tx/${hash}` : ''),
      confidence: 'high',
      source: 'zerion'
    };
  });

  const tradedTokens = new Map<string, { token: WalletActivityToken; totalUsdVolume: number; lastActivityAt: number; buys: number; sells: number; swaps: number; receives: number; sends: number }>();
  activities.forEach((activity) => {
    activity.tokens.forEach((token) => {
      const key = (token.address || token.symbol).toLowerCase();
      const current = tradedTokens.get(key) || { token, totalUsdVolume: 0, lastActivityAt: 0, buys: 0, sells: 0, swaps: 0, receives: 0, sends: 0 };
      current.totalUsdVolume += token.usdValue || 0;
      current.lastActivityAt = Math.max(current.lastActivityAt, activity.timestamp);
      if (activity.kind === 'buy') current.buys += 1;
      if (activity.kind === 'sell') current.sells += 1;
      if (activity.kind === 'swap') current.swaps += 1;
      if (activity.kind === 'receive') current.receives += 1;
      if (activity.kind === 'send') current.sends += 1;
      tradedTokens.set(key, current);
    });
  });

  const largestMove = activities.reduce((largest, activity) => (activity.usdValue || 0) > largest.value ? { value: activity.usdValue || 0, label: activity.title } : largest, { value: 0, label: 'No activity' });
  const mostTraded = Array.from(tradedTokens.values()).sort((a, b) => b.totalUsdVolume - a.totalUsdVolume)[0];
  const summary: WalletActivitySummary = {
    lastActiveAt: activities.reduce((latest, item) => Math.max(latest, item.timestamp), 0),
    recentBuys: activities.filter((item) => item.kind === 'buy' || item.kind === 'receive').length,
    recentSells: activities.filter((item) => item.kind === 'sell' || item.kind === 'send').length,
    largestMoveUsd: largestMove.value,
    largestMoveLabel: largestMove.label,
    mostTradedToken: mostTraded?.token.symbol || 'No token yet',
    netFlowUsd: activities.reduce((total, item) => total + (item.kind === 'send' || item.kind === 'sell' ? -(item.usdValue || 0) : item.usdValue || 0), 0)
  };

  return {
    activities,
    summary,
    tradedTokens: Array.from(tradedTokens.values()).map((row) => ({
      address: row.token.address,
      symbol: row.token.symbol,
      logo: row.token.logo,
      chain: 'All Chains',
      buys: row.buys,
      sells: row.sells,
      swaps: row.swaps,
      receives: row.receives,
      sends: row.sends,
      totalUsdVolume: row.totalUsdVolume,
      lastActivityAt: row.lastActivityAt
    })),
    providerStatus: 'ready',
    generatedAt: new Date().toISOString()
  };
}

function firstError(response: ZerionIntelligenceResponse) {
  return response.portfolio?.error || response.positions?.error || response.pnl?.error;
}

export function normalizeZerionIntelligence(response: ZerionIntelligenceResponse, options?: NormalizerOptions): { portfolio: WalletPortfolio; activity: WalletActivity } {
  const pnl = normalizePnl(response.pnl?.data);
  const overview = normalizePortfolioOverview(response.portfolio?.data);
  const recentFlows = deriveRecentTokenFlows(response.transactions?.data, options);
  const assets = normalizePositions(response.positions?.data, pnl.byToken, recentFlows);
  const tradePerformance = enrichTradePerformanceRows(pnl.rows, recentFlows);
  const historyPerformance = deriveHistoryPerformanceRows(recentFlows, assets, tradePerformance);
  const activity = normalizeTransactions(response.transactions?.data);
  const message = firstError(response);

  return {
    portfolio: {
      netWorth: formatUsd(overview.netWorth),
      assets,
      providerStatus: message ? 'error' : 'ready',
      message,
      generatedAt: response.generatedAt || new Date().toISOString(),
      overview,
      pnl: pnl.summary,
      tradePerformance: [...tradePerformance, ...historyPerformance]
    },
    activity: {
      ...activity,
      providerStatus: response.transactions?.error ? 'partial' : 'ready',
      message: response.transactions?.error,
      generatedAt: response.generatedAt || activity.generatedAt
    }
  };
}
