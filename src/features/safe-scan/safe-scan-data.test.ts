import { describe, expect, it } from 'vitest';
import { clusterSupplyBalance, collectLabels, enrichWalletRows, inferSupplyFromClusters } from './safe-scan-data';

describe('Safe Scan data helpers', () => {
  it('deduplicates cluster member balances by wallet address', () => {
    const clusters = [
      {
        members: [
          { address: 'wallet-a', balance: 10 },
          { address: 'wallet-b', balance: 5 }
        ]
      },
      {
        members: [
          { address: 'wallet-a', balance: 10 },
          { address: 'wallet-c', balance: 2 }
        ]
      }
    ];

    expect(clusterSupplyBalance(clusters)).toBe(17);
  });

  it('uses fallback percent when cluster balances are absent', () => {
    expect(clusterSupplyBalance([], 1_000_000, 12.5)).toBe(125_000);
  });

  it('infers total supply from balance and percentage rows', () => {
    const clusters = [{ members: [{ address: 'wallet-a', balance: 100, percentage: 10 }] }];
    expect(inferSupplyFromClusters(clusters)).toBe(1_000);
  });

  it('collects labels from common response envelopes', () => {
    expect(collectLabels({ labels: [{ address: 'a', label: 'Creator', smart_contract: false }] })).toHaveLength(1);
    expect(collectLabels({ data: [{ address: 'b', label: 'CEX', smart_contract: true }] })).toHaveLength(1);
  });

  it('enriches wallet rows with label metadata', () => {
    const rows = [{ address: '0xabc', balance: 10 }];
    const labels = new Map([['0xabc', { address: '0xabc', label: 'Known wallet', tags: ['maker'], smart_contract: false }]]);

    expect(enrichWalletRows(rows, labels)[0]).toMatchObject({
      label: 'Known wallet',
      tags: ['maker']
    });
  });
});
