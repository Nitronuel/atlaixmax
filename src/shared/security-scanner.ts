import type { BubblemapsChain } from './bubblemaps';

export type SecurityFlagState = 'safe' | 'risk' | 'unknown';

export type SecurityFlag = {
  label: string;
  value: string;
  state: SecurityFlagState;
};

export type LiquidityLockReport = {
  status: 'locked' | 'unlocked' | 'unknown' | 'unsupported';
  lockedPercent: number | null;
  lockedUsd: number | null;
  lockers: Array<{
    address: string;
    label: string;
    percent: number | null;
    locked: boolean;
  }>;
  message: string;
};

export type SecurityScannerReport = {
  chain: BubblemapsChain;
  address: string;
  provider: 'goplus';
  status: 'available' | 'unsupported' | 'missing' | 'error';
  message?: string;
  fetchedAt: string;
  flags: SecurityFlag[];
  liquidityLock: LiquidityLockReport;
};
