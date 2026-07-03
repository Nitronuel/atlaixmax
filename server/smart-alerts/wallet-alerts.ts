import { createVerify } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { readEnv } from '../env';
import { SmartAlertStore, type SmartAlertRow } from './store';

type WalletAlertEventType = 'any' | 'buy' | 'sell' | 'trade' | 'receive' | 'send' | 'execute' | 'approval' | 'rollback' | 'unknown';

type ZerionSubscriptionState = {
  subscriptionId?: string;
  callbackUrl?: string;
  addresses?: string[];
  updatedAt?: string;
};

type ZerionSubscriptionResult = {
  status: 'subscribed' | 'callback_missing' | 'provider_missing' | 'subscription_failed';
  subscriptionId?: string;
  message?: string;
};

type WalletTransfer = {
  direction: string;
  symbol: string;
  name: string;
  amount: number | null;
};

type WalletWebhookEvent = {
  walletAddress: string;
  chain: string;
  hash: string;
  transactionId: string;
  minedAt: string | null;
  operationType: string;
  kind: WalletAlertEventType;
  side: 'buy' | 'sell' | 'swap' | null;
  status: string;
  deleted: boolean;
  isTrash: boolean;
  transfers: WalletTransfer[];
  dappName: string | null;
};

export type CreateWalletActivityAlertInput = {
  address: string;
  chain?: string;
  label?: string;
  eventTypes?: string[];
  notificationChannels?: string[];
  ignoreSpam?: boolean;
  cooldownMinutes?: number;
};

const ZERION_BASE_URL = 'https://api.zerion.io/v1';
const certCache = new Map<string, string>();
const stableSymbols = new Set(['USDC', 'USDT', 'DAI', 'USDE', 'USDS', 'USD', 'PYUSD', 'TUSD', 'USDP', 'FDUSD']);
const nativeSymbols = new Set(['ETH', 'WETH', 'SOL', 'WSOL', 'BNB', 'MATIC', 'POL', 'AVAX']);

function statePath() {
  return resolve(process.cwd(), '.data', 'zerion-wallet-alerts.json');
}

function readSubscriptionState(): ZerionSubscriptionState {
  const filepath = statePath();
  if (!existsSync(filepath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(filepath, 'utf8')) as ZerionSubscriptionState;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeSubscriptionState(state: ZerionSubscriptionState) {
  const filepath = statePath();
  mkdirSync(dirname(filepath), { recursive: true });
  writeFileSync(filepath, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2));
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || '' : value || '';
}

function lower(value: unknown) {
  return stringValue(value).trim().toLowerCase();
}

function compactAddress(value: string) {
  return value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-6)}` : value;
}

function normalizeEventTypes(value: unknown): WalletAlertEventType[] {
  const next = Array.isArray(value) ? value.map((item) => lower(item)) : [];
  const allowed = new Set<WalletAlertEventType>(['any', 'buy', 'sell', 'trade', 'receive', 'send', 'execute', 'approval', 'rollback', 'unknown']);
  const filtered = next.filter((item): item is WalletAlertEventType => allowed.has(item as WalletAlertEventType));
  return filtered.length ? Array.from(new Set(filtered)) : ['any'];
}

function normalizeChannels(value: unknown) {
  const channels = Array.isArray(value) ? value.map(String).filter(Boolean) : [];
  return channels.length ? channels : ['in_app'];
}

function normalizeChainLabel(value: unknown) {
  const chain = lower(value);
  const labels: Record<string, string> = {
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
  if (!chain || chain === 'all chains') return 'All Chains';
  return labels[chain] || stringValue(value) || 'All Chains';
}

function chainMatches(ruleChain: string, eventChain: string) {
  const rule = normalizeChainLabel(ruleChain);
  return rule === 'All Chains' || rule === normalizeChainLabel(eventChain);
}

function authHeader(apiKey: string) {
  return `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`;
}

async function zerionSubscriptionRequest(path: string, init: RequestInit = {}) {
  const apiKey = readEnv('ZERION_API_KEY', 'VITE_ZERION_API_KEY');
  if (!apiKey) throw new Error('Set ZERION_API_KEY before enabling Zerion wallet alerts.');
  const response = await fetch(`${ZERION_BASE_URL}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: authHeader(apiKey),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {})
    }
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `Zerion subscription request failed with ${response.status}.`);
  }
  return response.status === 204 ? null : response.json().catch(() => null);
}

async function ensureZerionSubscription(address: string): Promise<ZerionSubscriptionResult> {
  const callbackUrl = readEnv('ZERION_WEBHOOK_CALLBACK_URL').trim();
  const apiKey = readEnv('ZERION_API_KEY', 'VITE_ZERION_API_KEY').trim();
  if (!callbackUrl) {
    return {
      status: 'callback_missing',
      message: 'Set ZERION_WEBHOOK_CALLBACK_URL before live wallet webhooks can be delivered.'
    };
  }
  if (!apiKey) {
    return {
      status: 'provider_missing',
      message: 'Set ZERION_API_KEY before live wallet webhooks can be delivered.'
    };
  }

  const normalizedAddress = address.trim();
  const state = readSubscriptionState();
  const subscriptionId = readEnv('ZERION_TX_SUBSCRIPTION_ID').trim() || state.subscriptionId;

  try {
    if (subscriptionId) {
      await zerionSubscriptionRequest(`/tx-subscriptions/${encodeURIComponent(subscriptionId)}/wallets`, {
        method: 'PATCH',
        body: JSON.stringify({ add: [normalizedAddress] })
      });
      writeSubscriptionState({
        subscriptionId,
        callbackUrl,
        addresses: Array.from(new Set([...(state.addresses || []), normalizedAddress]))
      });
      return { status: 'subscribed', subscriptionId };
    }

    const payload = await zerionSubscriptionRequest('/tx-subscriptions/', {
      method: 'POST',
      body: JSON.stringify({ callback_url: callbackUrl, addresses: [normalizedAddress] })
    });
    const id = stringValue(record(record(payload).data).id);
    writeSubscriptionState({ subscriptionId: id, callbackUrl, addresses: [normalizedAddress] });
    return { status: 'subscribed', subscriptionId: id };
  } catch (error) {
    return {
      status: 'subscription_failed',
      subscriptionId,
      message: error instanceof Error ? error.message : 'Could not update Zerion wallet subscription.'
    };
  }
}

function walletRuleMetadata(rule: SmartAlertRow) {
  const metadata = record(rule.metadata);
  const wallet = record(metadata.wallet);
  return {
    metadata,
    walletAddress: stringValue(wallet.address),
    walletChain: normalizeChainLabel(wallet.chain || rule.chain_id),
    eventTypes: normalizeEventTypes(metadata.eventTypes),
    ignoreSpam: metadata.ignoreSpam !== false
  };
}

function sameEventTypes(left: WalletAlertEventType[], right: WalletAlertEventType[]) {
  return left.length === right.length && left.every((item) => right.includes(item));
}

export async function createWalletActivityAlert(store: SmartAlertStore, input: CreateWalletActivityAlertInput, userId: string) {
  const address = input.address.trim();
  if (!address) throw new Error('Wallet address is required.');

  const chain = normalizeChainLabel(input.chain || 'All Chains');
  const label = input.label?.trim() || compactAddress(address);
  const eventTypes = normalizeEventTypes(input.eventTypes);
  const notificationChannels = normalizeChannels(input.notificationChannels);
  const ignoreSpam = input.ignoreSpam !== false;
  const existing = (await store.listRules(userId)).find((rule) => {
    if (rule.alert_type !== 'Wallet' || rule.metadata?.alertMode !== 'wallet_activity') return false;
    const wallet = walletRuleMetadata(rule);
    return lower(wallet.walletAddress) === lower(address)
      && chainMatches(wallet.walletChain, chain)
      && sameEventTypes(wallet.eventTypes, eventTypes)
      && rule.enabled;
  }) || null;

  const subscription = await ensureZerionSubscription(address);
  const eventLabel = eventTypes.includes('any') ? 'any activity' : eventTypes.map((item) => item.replace('execute', 'contract')).join(', ');
  const metadata = {
    alertMode: 'wallet_activity',
    createdFrom: 'wallet_page',
    status: 'active',
    wallet: { address, chain, label },
    eventTypes,
    ignoreSpam,
    subscription
  };

  if (existing) {
    const updated = await store.updateRule(existing.id, {
      notification_channels: notificationChannels,
      metadata: { ...existing.metadata, ...metadata },
      last_error: subscription.status === 'subscribed' ? null : subscription.message || null
    }, userId);
    return { rule: updated, subscription };
  }

  const rule = await store.createRule({
    alertType: 'Wallet',
    target: label,
    chainId: chain,
    tokenAddress: null,
    condition: 'event_is',
    thresholdKind: 'event',
    threshold: eventTypes.includes('any') ? 'Any wallet activity' : eventTypes.join(','),
    triggerLabel: `${label}: ${eventLabel}`,
    notificationChannels,
    cooldownMinutes: input.cooldownMinutes ?? 1,
    metadata
  }, userId);

  if (subscription.status !== 'subscribed') {
    const updated = await store.updateRule(rule.id, {
      last_error: subscription.message || 'Zerion wallet subscription is not active yet.'
    }, userId);
    return { rule: updated, subscription };
  }

  return { rule, subscription };
}

async function fetchCertificate(certUrl: string) {
  if (certCache.has(certUrl)) return certCache.get(certUrl) || '';
  const url = new URL(certUrl);
  if (url.protocol !== 'https:' || (url.hostname !== 'zerion.io' && !url.hostname.endsWith('.zerion.io'))) {
    throw new Error(`Untrusted Zerion certificate host: ${url.hostname}`);
  }
  const response = await fetch(certUrl);
  if (!response.ok) throw new Error(`Could not fetch Zerion webhook certificate (${response.status}).`);
  const pem = await response.text();
  certCache.set(certUrl, pem);
  return pem;
}

async function verifyWebhookSignature(headers: IncomingHttpHeaders, rawBody: string) {
  if (readEnv('ZERION_WEBHOOK_SKIP_SIGNATURE').toLowerCase() === 'true' && readEnv('NODE_ENV') !== 'production') {
    return;
  }

  const timestamp = headerValue(headers['x-timestamp']);
  const signature = headerValue(headers['x-signature']);
  const certificateUrl = headerValue(headers['x-certificate-url']);
  if (!timestamp || !signature || !certificateUrl) {
    throw new Error('Missing Zerion webhook signature headers.');
  }

  const pem = await fetchCertificate(certificateUrl);
  const verifier = createVerify('SHA256');
  verifier.update(`${timestamp}\n${rawBody}\n`);
  if (!verifier.verify(pem, signature, 'base64')) {
    certCache.delete(certificateUrl);
    const freshPem = await fetchCertificate(certificateUrl);
    const freshVerifier = createVerify('SHA256');
    freshVerifier.update(`${timestamp}\n${rawBody}\n`);
    if (!freshVerifier.verify(freshPem, signature, 'base64')) {
      throw new Error('Invalid Zerion webhook signature.');
    }
  }
}

function parseTransfer(value: unknown): WalletTransfer {
  const row = record(value);
  const fungible = record(row.fungible_info);
  const quantity = record(row.quantity);
  const amount = Number(quantity.float ?? quantity.numeric);
  return {
    direction: lower(row.direction),
    symbol: stringValue(fungible.symbol).toUpperCase(),
    name: stringValue(fungible.name),
    amount: Number.isFinite(amount) ? amount : null
  };
}

function tokenIsStableOrNative(transfer: WalletTransfer) {
  return stableSymbols.has(transfer.symbol) || nativeSymbols.has(transfer.symbol);
}

function classifyEvent(operationType: string, transfers: WalletTransfer[], deleted: boolean): Pick<WalletWebhookEvent, 'kind' | 'side'> {
  if (deleted) return { kind: 'rollback', side: null };
  const operation = operationType.toLowerCase();
  if (operation.includes('approval')) return { kind: 'approval', side: null };
  if (operation.includes('send')) return { kind: 'send', side: null };
  if (operation.includes('receive')) return { kind: 'receive', side: null };

  const incoming = transfers.filter((item) => item.direction === 'in');
  const outgoing = transfers.filter((item) => item.direction === 'out');
  const isTrade = operation.includes('trade') || operation.includes('swap') || (incoming.length > 0 && outgoing.length > 0);
  if (isTrade) {
    const incomingCore = incoming.some((item) => !tokenIsStableOrNative(item));
    const outgoingCore = outgoing.some((item) => !tokenIsStableOrNative(item));
    const incomingSettlement = incoming.some(tokenIsStableOrNative);
    const outgoingSettlement = outgoing.some(tokenIsStableOrNative);
    if (incomingCore && outgoingSettlement) return { kind: 'trade', side: 'buy' };
    if (outgoingCore && incomingSettlement) return { kind: 'trade', side: 'sell' };
    return { kind: 'trade', side: 'swap' };
  }

  if (operation.includes('execute')) return { kind: 'execute', side: null };
  return { kind: 'unknown', side: null };
}

function extractWebhookEvents(payload: unknown): WalletWebhookEvent[] {
  const body = record(payload);
  const notification = record(body.data);
  const notificationAttrs = record(notification.attributes);
  const walletAddress = stringValue(notificationAttrs.address);
  const included = array(body.included);

  return included
    .filter((item) => record(item).type === 'transactions')
    .map((item) => {
      const tx = record(item);
      const attrs = record(tx.attributes);
      const relationships = record(tx.relationships);
      const chain = normalizeChainLabel(record(record(relationships.chain).data).id || record(relationships.chain).id);
      const transfers = array(attrs.transfers).map(parseTransfer);
      const flags = record(attrs.flags);
      const applicationMetadata = record(attrs.application_metadata);
      const { kind, side } = classifyEvent(stringValue(attrs.operation_type), transfers, Boolean(attrs.deleted));
      return {
        walletAddress,
        chain,
        hash: stringValue(attrs.hash) || stringValue(tx.id),
        transactionId: stringValue(tx.id),
        minedAt: stringValue(attrs.mined_at) || null,
        operationType: stringValue(attrs.operation_type) || 'unknown',
        kind,
        side,
        status: stringValue(attrs.status) || 'unknown',
        deleted: Boolean(attrs.deleted),
        isTrash: Boolean(flags.is_trash),
        transfers,
        dappName: stringValue(applicationMetadata.name) || null
      };
    })
    .filter((event) => event.walletAddress && event.hash);
}

function eventMatchesRule(rule: SmartAlertRow, event: WalletWebhookEvent) {
  if (!rule.enabled || rule.alert_type !== 'Wallet' || rule.metadata?.alertMode !== 'wallet_activity') return false;
  const wallet = walletRuleMetadata(rule);
  if (lower(wallet.walletAddress) !== lower(event.walletAddress)) return false;
  if (!chainMatches(wallet.walletChain, event.chain)) return false;
  if (wallet.ignoreSpam && event.isTrash) return false;
  if (wallet.eventTypes.includes('any')) return true;
  if (wallet.eventTypes.includes(event.kind)) return true;
  if (event.kind === 'trade' && (event.side === 'buy' || event.side === 'sell') && wallet.eventTypes.includes(event.side)) return true;
  return false;
}

function transferSummary(event: WalletWebhookEvent) {
  const primary = event.transfers
    .filter((item) => item.symbol)
    .slice(0, 3)
    .map((item) => `${item.direction || 'move'} ${item.amount === null ? '' : item.amount.toLocaleString(undefined, { maximumSignificantDigits: 6 })} ${item.symbol}`.trim());
  return primary.length ? primary.join(', ') : event.operationType;
}

function eventLabel(event: WalletWebhookEvent) {
  if (event.kind === 'trade' && event.side === 'buy') return 'buy';
  if (event.kind === 'trade' && event.side === 'sell') return 'sell';
  if (event.kind === 'trade') return 'trade';
  if (event.kind === 'execute') return 'contract interaction';
  return event.kind;
}

export async function processWalletWebhook(store: SmartAlertStore, rawBody: string, headers: IncomingHttpHeaders) {
  await verifyWebhookSignature(headers, rawBody);
  const payload = rawBody ? JSON.parse(rawBody) : {};
  const events = extractWebhookEvents(payload);
  const rules = (await store.listRules()).filter((rule) => rule.alert_type === 'Wallet' && rule.metadata?.alertMode === 'wallet_activity');
  let triggersCreated = 0;

  for (const event of events) {
    const matchingRules = rules.filter((rule) => eventMatchesRule(rule, event));
    for (const rule of matchingRules) {
      const wallet = walletRuleMetadata(rule);
      const inserted = await store.insertTrigger({
        alert_rule_id: rule.id,
        user_id: rule.user_id,
        alert_type: 'Wallet',
        title: `Wallet ${eventLabel(event)}`,
        message: `${wallet.metadata.wallet && record(wallet.metadata.wallet).label ? stringValue(record(wallet.metadata.wallet).label) : compactAddress(event.walletAddress)} ${eventLabel(event)} on ${event.chain}: ${transferSummary(event)}.`,
        observed_value: event.status,
        threshold: rule.threshold,
        source: 'zerion-wallet-webhook',
        dedupe_key: `wallet:${rule.id}:${event.chain.toLowerCase()}:${event.hash}:${event.deleted ? 'rollback' : 'confirmed'}`,
        metadata: {
          alertSource: 'wallet_activity',
          eventType: event.kind,
          side: event.side,
          wallet: {
            address: event.walletAddress,
            chain: event.chain,
            label: stringValue(record(wallet.metadata.wallet).label) || compactAddress(event.walletAddress)
          },
          transaction: {
            hash: event.hash,
            id: event.transactionId,
            minedAt: event.minedAt,
            operationType: event.operationType,
            status: event.status,
            deleted: event.deleted,
            isTrash: event.isTrash,
            dappName: event.dappName,
            transfers: event.transfers
          },
          walletUrl: `/wallet/${encodeURIComponent(event.walletAddress)}?chain=${encodeURIComponent(event.chain)}`
        }
      });

      if (inserted) {
        triggersCreated += 1;
        await store.updateRule(rule.id, {
          last_checked_at: new Date().toISOString(),
          last_triggered_at: new Date().toISOString(),
          last_observed_value: event.status,
          last_observed_at: new Date().toISOString(),
          trigger_count: Number(rule.trigger_count || 0) + 1,
          last_error: null
        }, rule.user_id);
      }
    }
  }

  return { received: events.length, triggersCreated };
}
