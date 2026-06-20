import { describe, expect, it } from 'vitest';
import { clusterSupplyBalance, clusterSupplyPercent, enrichWalletRows, holderSupplyPercent, inferredTotalSupply, labelMap, largestCluster, supplyPercentField } from './safe-scan-data';

describe('Safe Scan Bubblemaps data helpers', () => {
  it('sums cluster token amounts from Bubblemaps clusters', () => {
    expect(clusterSupplyBalance([
      { amount: 10, share: 0.1, holder_count: 2, holders: ['a', 'b'] },
      { amount: 7, share: 0.07, holder_count: 1, holders: ['c'] }
    ])).toBe(17);
  });

  it('finds the largest cluster by supply share', () => {
    expect(largestCluster([
      { amount: 10, share: 0.1, holder_count: 2, holders: ['a', 'b'] },
      { amount: 30, share: 0.3, holder_count: 4, holders: ['c'] }
    ])?.share).toBe(0.3);
  });

  it('normalizes holder share into percent scale', () => {
    expect(supplyPercentField({ holder_data: { amount: 100, rank: 1, share: 0.25 } })).toBe(25);
  });

  it('infers total supply from holder amount and share before using clusters', () => {
    expect(inferredTotalSupply([
      { amount: 342_800_000, share: 0.339, holder_count: 16, holders: [] }
    ], [{
      address: '0xabc',
      holder_data: { amount: 40_000_000, rank: 1, share: 0.04 }
    }])).toBe(1_000_000_000);
  });

  it('falls back to cluster fraction scale when holder totals are unavailable', () => {
    expect(inferredTotalSupply([
      { amount: 342_800_000, share: 0.339, holder_count: 16, holders: [] }
    ])).toBeCloseTo(1_011_209_439.5280236);
  });

  it('normalizes cluster fraction shares into percentage scale', () => {
    expect(clusterSupplyPercent({
      amount: 3_530_000,
      share: 0.353,
      holder_count: 3,
      holders: []
    }, 1_000_000_000)).toBe(35.3);
  });

  it('can still infer total supply from Bubblemaps percent-point cluster share', () => {
    expect(inferredTotalSupply([
      { amount: 20_000_000, share: 0.02, holder_count: 2, holders: [] }
    ], [])).toBe(1_000_000_000);
  });

  it('calculates holder controlled supply from amount when total supply is known', () => {
    expect(holderSupplyPercent({
      address: '0xabc',
      holder_data: { amount: 1_000_000, rank: 1, share: 0.977 }
    }, 1_000_000_000)).toBe(0.1);
  });

  it('builds labels from Bubblemaps holder address metadata', () => {
    const labels = labelMap([{
      address: '0xabc',
      holder_data: { amount: 10, rank: 1, share: 0.1 },
      address_details: {
        label: 'Known wallet',
        degree: 2,
        is_supernode: false,
        is_contract: false,
        is_cex: true,
        is_dex: false,
        inward_relations: 1,
        outward_relations: 1
      }
    }]);

    expect(labels.get('0xabc')?.address_details.label).toBe('Known wallet');
  });

  it('enriches wallet rows with address metadata', () => {
    const rows = [{ address: '0xabc', holder_data: { amount: 10, rank: 1, share: 0.1 } }];
    const labels = new Map([['0xabc', {
      address: '0xabc',
      address_details: {
        label: 'Known wallet',
        degree: 2,
        is_supernode: false,
        is_contract: false,
        is_cex: true,
        is_dex: false,
        inward_relations: 1,
        outward_relations: 1
      }
    }]]);

    expect(enrichWalletRows(rows, labels)[0].address_details?.label).toBe('Known wallet');
  });
});
