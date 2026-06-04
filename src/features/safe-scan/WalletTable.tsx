import type { WalletEntry } from '../../shared/insightx';
import { formatCompact, formatPercent, shortenAddress } from './format';
import { enrichWalletRows, supplyPercentField, walletAddress, walletBalance } from './safe-scan-data';
import { EmptyBlock, type LabelMap } from './ui';

function walletShare(entry: WalletEntry, totalSupply?: number | null) {
  const balance = walletBalance(entry);
  const supply = Number(totalSupply);
  if (Number.isFinite(balance) && balance > 0 && Number.isFinite(supply) && supply > 0) {
    return formatPercent((balance / supply) * 100);
  }
  return formatPercent(supplyPercentField(entry));
}

export function WalletTable({ rows, labels, totalSupply, empty, maxRows = 80 }: {
  rows: WalletEntry[];
  labels: LabelMap;
  totalSupply?: number | null;
  empty: string;
  maxRows?: number;
}) {
  const visibleRows = enrichWalletRows(Array.isArray(rows) ? rows : [], labels).slice(0, maxRows);
  if (!visibleRows.length) return <EmptyBlock title="No wallet rows" body={empty} />;

  return (
    <div className="wallet-table" role="table" aria-label="Wallet rows">
      <div className="wallet-row wallet-row-head" role="row">
        <span>Wallet</span>
        <span>Label</span>
        <span>Balance</span>
        <span>Supply</span>
        <span>Evidence</span>
      </div>
      {visibleRows.map((row) => {
        const address = walletAddress(row);
        const evidence = Array.isArray(row.reasons) && row.reasons.length ? row.reasons.join(', ') : 'Detected relationship';
        return (
          <div className="wallet-row" role="row" key={address}>
            <span className="wallet-address">
              <strong>{row.label || shortenAddress(address)}</strong>
              <small>{address ? shortenAddress(address) : 'wallet'}</small>
            </span>
            <strong>{row.label || 'Unlabeled'}</strong>
            <span>{formatCompact(walletBalance(row))}</span>
            <span>{walletShare(row, totalSupply)}</span>
            <span>{evidence}</span>
          </div>
        );
      })}
    </div>
  );
}
