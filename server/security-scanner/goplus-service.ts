import type { BubblemapsChain } from '../../src/shared/bubblemaps';
import type { LiquidityLockReport, SecurityFlag, SecurityScannerReport, SecurityFlagState } from '../../src/shared/security-scanner';
import { readEnv } from '../env';

type GoPlusPayload = Record<string, unknown>;
type GoPlusLpHolder = Record<string, unknown>;

const GOPLUS_BASE_URL = 'https://api.gopluslabs.io';
const REQUEST_TIMEOUT_MS = 12_000;

const evmChainIds: Partial<Record<BubblemapsChain, string>> = {
  eth: '1',
  bsc: '56',
  polygon: '137',
  avalanche: '43114',
  base: '8453',
  arbitrum: '42161',
  sonic: '146'
};

function getBaseUrl() {
  return readEnv('GOPLUS_BASE_URL') || GOPLUS_BASE_URL;
}

function getApiKey() {
  return readEnv('GOPLUS_API_KEY', 'GOPLUS_ACCESS_TOKEN');
}

function asString(value: unknown) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function isOne(value: unknown) {
  return asString(value) === '1';
}

function isZero(value: unknown) {
  return asString(value) === '0';
}

function statusValue(value: unknown) {
  if (value && typeof value === 'object' && 'status' in value) {
    return asString((value as { status?: unknown }).status);
  }
  return asString(value);
}

function hasData(value: unknown) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return Boolean(asString(value));
}

function asArray(value: unknown): GoPlusLpHolder[] {
  return Array.isArray(value) ? value.filter((item): item is GoPlusLpHolder => Boolean(item) && typeof item === 'object') : [];
}

function asNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function flag(label: string, value: string, state: SecurityFlagState): SecurityFlag {
  return { label, value, state };
}

function boolFlag(label: string, value: unknown, riskWhenOne = true) {
  if (isOne(value)) return flag(label, riskWhenOne ? 'Yes' : 'No', riskWhenOne ? 'risk' : 'safe');
  if (isZero(value)) return flag(label, riskWhenOne ? 'No' : 'Yes', riskWhenOne ? 'safe' : 'risk');
  return flag(label, 'Unknown', 'unknown');
}

function positiveFlag(label: string, value: unknown) {
  if (isOne(value)) return flag(label, 'Yes', 'safe');
  if (isZero(value)) return flag(label, 'No', 'risk');
  return flag(label, 'Unknown', 'unknown');
}

function taxFlag(data: GoPlusPayload) {
  const values = [data.buy_tax, data.sell_tax, data.transfer_tax]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!values.length) {
    const hasZeroTax = [data.buy_tax, data.sell_tax, data.transfer_tax].some((value) => isZero(value));
    return hasZeroTax ? flag('Tax', 'No', 'safe') : flag('Tax', 'Unknown', 'unknown');
  }
  const maxTax = Math.max(...values);
  return flag('Tax', `${Math.round(maxTax * 10000) / 100}%`, maxTax >= 0.1 ? 'risk' : 'safe');
}

function mapEvmFlags(data: GoPlusPayload) {
  const canTakeBackOwnership = data.can_take_back_ownership;
  const hiddenOwner = data.hidden_owner;
  const renouncedKnown = isZero(canTakeBackOwnership) && isZero(hiddenOwner);
  return [
    boolFlag('Honeypot', data.is_honeypot),
    renouncedKnown ? flag('Renounced', 'Yes', 'safe') : flag('Renounced', 'Unknown', 'unknown'),
    boolFlag('Mintable', data.is_mintable),
    boolFlag('Freezable', data.is_blacklisted),
    boolFlag('Drainable', isOne(data.selfdestruct) || isOne(data.external_call) || isOne(data.can_take_back_ownership) ? '1' : isZero(data.selfdestruct) ? '0' : ''),
    boolFlag('Pausable', data.transfer_pausable),
    positiveFlag('Verified', data.is_open_source),
    boolFlag('Proxy contract', data.is_proxy),
    taxFlag(data)
  ];
}

function mapSolanaFlags(data: GoPlusPayload) {
  const mintable = statusValue(data.mintable);
  const freezable = statusValue(data.freezable);
  const closable = statusValue(data.closable);
  const metadataMutable = statusValue(data.metadata_mutable);
  const transferFee = statusValue(data.transfer_fee);
  const transferHook = statusValue(data.transfer_hook);
  const trusted = data.trusted_token;
  const hasTransferFee = hasData(data.transfer_fee) && !isZero(transferFee);
  const hasTransferHook = hasData(data.transfer_hook) && !isZero(transferHook);

  return [
    flag('Honeypot', 'Unknown', 'unknown'),
    isZero(metadataMutable) ? flag('Renounced', 'Yes', 'safe') : isOne(metadataMutable) ? flag('Renounced', 'No', 'risk') : flag('Renounced', 'Unknown', 'unknown'),
    boolFlag('Mintable', mintable),
    boolFlag('Freezable', freezable),
    boolFlag('Drainable', closable),
    boolFlag('Pausable', data.non_transferable),
    positiveFlag('Verified', trusted),
    hasTransferHook ? flag('Proxy contract', 'Yes', 'risk') : flag('Proxy contract', 'No', 'safe'),
    hasTransferFee ? flag('Tax', 'Yes', 'risk') : flag('Tax', 'No', 'safe')
  ];
}

function lockLabel(holder: GoPlusLpHolder) {
  return [
    holder.tag,
    holder.name,
    holder.label,
    holder.address_tag,
    holder.contract_name
  ].map(asString).find(Boolean) || '';
}

function lockPercent(holder: GoPlusLpHolder) {
  const value = asNumber(holder.percent ?? holder.lp_percent ?? holder.share ?? holder.locked_percent);
  if (value === null) return null;
  return value > 0 && value <= 1 ? value * 100 : value;
}

function isLockHolder(holder: GoPlusLpHolder) {
  const address = asString(holder.address).toLowerCase();
  const label = lockLabel(holder).toLowerCase();
  const lockedField = holder.is_locked ?? holder.locked ?? holder.is_lock ?? holder.is_lp_locked;
  if (isOne(lockedField) || lockedField === true) return true;
  if (address === '0x000000000000000000000000000000000000dead' || address === '0x0000000000000000000000000000000000000000') return true;
  return ['lock', 'burn', 'dead', 'pinklock', 'unicrypt', 'team.finance', 'mudra', 'dxlock'].some((term) => label.includes(term));
}

function mapLiquidityLock(data: GoPlusPayload, chain: BubblemapsChain): LiquidityLockReport {
  if (chain === 'solana') {
    return {
      status: 'unsupported',
      lockedPercent: null,
      lockedUsd: null,
      lockers: [],
      message: 'N/A'
    };
  }

  const holders = asArray(data.lp_holders);
  if (!holders.length) {
    return {
      status: isOne(data.is_in_dex) ? 'unknown' : 'unlocked',
      lockedPercent: null,
      lockedUsd: null,
      lockers: [],
      message: 'N/A'
    };
  }

  const lockers = holders
    .filter(isLockHolder)
    .map((holder) => ({
      address: asString(holder.address),
      label: lockLabel(holder) || 'Locked LP holder',
      percent: lockPercent(holder),
      locked: true
    }));
  const lockedPercent = lockers.reduce((sum, holder) => sum + (holder.percent || 0), 0);

  if (lockers.length && lockedPercent > 0) {
    return {
      status: 'locked',
      lockedPercent,
      lockedUsd: null,
      lockers,
      message: `${Math.round(lockedPercent * 100) / 100}% of reported LP tokens are locked or burned.`
    };
  }

  return {
    status: 'unlocked',
    lockedPercent: 0,
    lockedUsd: null,
    lockers: [],
    message: 'N/A'
  };
}

export class GoPlusSecurityService {
  async getTokenSecurity(chain: BubblemapsChain, address: string): Promise<SecurityScannerReport> {
    const fetchedAt = new Date().toISOString();
    const normalizedAddress = address.trim();
    const path = this.endpointPath(chain, normalizedAddress);

    if (!path) {
      return {
        chain,
        address: normalizedAddress,
        provider: 'goplus',
        status: 'unsupported',
        message: 'GoPlus security checks are not available for this chain yet.',
        fetchedAt,
        flags: this.unknownFlags(),
        liquidityLock: this.unknownLiquidityLock('N/A', 'unsupported')
      };
    }

    try {
      const response = await fetch(new URL(path, getBaseUrl()), {
        headers: this.headers(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
      const payload = await response.json().catch(() => ({})) as { code?: number; message?: string; result?: Record<string, GoPlusPayload> | null };

      if (!response.ok || payload.code !== 1) {
        return {
          chain,
          address: normalizedAddress,
          provider: 'goplus',
          status: 'error',
          message: payload.message || `GoPlus request failed with status ${response.status}.`,
          fetchedAt,
          flags: this.unknownFlags(),
          liquidityLock: this.unknownLiquidityLock('N/A')
        };
      }

      const data = this.resultForAddress(payload.result, normalizedAddress);
      if (!data) {
        return {
          chain,
          address: normalizedAddress,
          provider: 'goplus',
          status: 'missing',
          message: 'GoPlus did not return security data for this token.',
          fetchedAt,
          flags: this.unknownFlags(),
          liquidityLock: this.unknownLiquidityLock('N/A')
        };
      }

      return {
        chain,
        address: normalizedAddress,
        provider: 'goplus',
        status: 'available',
        fetchedAt,
        flags: chain === 'solana' ? mapSolanaFlags(data) : mapEvmFlags(data),
        liquidityLock: mapLiquidityLock(data, chain)
      };
    } catch (error) {
      return {
        chain,
        address: normalizedAddress,
        provider: 'goplus',
        status: 'error',
        message: error instanceof Error ? error.message : 'GoPlus security request failed.',
        fetchedAt,
        flags: this.unknownFlags(),
        liquidityLock: this.unknownLiquidityLock('N/A')
      };
    }
  }

  private endpointPath(chain: BubblemapsChain, address: string) {
    if (chain === 'solana') return `/api/v1/solana/token_security?contract_addresses=${encodeURIComponent(address)}`;
    const chainId = evmChainIds[chain];
    return chainId ? `/api/v1/token_security/${chainId}?contract_addresses=${encodeURIComponent(address)}` : '';
  }

  private headers() {
    const headers: Record<string, string> = { accept: 'application/json' };
    const apiKey = getApiKey();
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    return headers;
  }

  private resultForAddress(result: Record<string, GoPlusPayload> | null | undefined, address: string) {
    if (!result) return null;
    return result[address] || result[address.toLowerCase()] || Object.values(result)[0] || null;
  }

  private unknownFlags() {
    return [
      'Honeypot',
      'Renounced',
      'Mintable',
      'Freezable',
      'Drainable',
      'Pausable',
      'Verified',
      'Proxy contract',
      'Tax'
    ].map((label) => flag(label, 'Unknown', 'unknown'));
  }

  private unknownLiquidityLock(message: string, status: LiquidityLockReport['status'] = 'unknown'): LiquidityLockReport {
    return {
      status,
      lockedPercent: null,
      lockedUsd: null,
      lockers: [],
      message
    };
  }
}
