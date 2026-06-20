import type { TokenHolder } from '../../shared/bubblemaps';
import { formatCompact, formatNumber, formatPercentPoints, shortenAddress } from './format';
import { enrichWalletRows, holderSupplyPercent, walletAddress, walletBalance } from './safe-scan-data';
import { EmptyBlock, type LabelMap } from './ui';

function walletTags(row: TokenHolder) {
  const details = row.address_details;
  const tags = [
    details?.is_cex ? 'CEX' : '',
    details?.is_dex ? 'DEX' : '',
    details?.is_contract ? 'Contract' : '',
    details?.is_supernode ? 'Supernode' : ''
  ].filter(Boolean);
  return tags.length ? tags.join(', ') : 'Wallet';
}

export function WalletTable({ rows, labels, empty, maxRows = 80, totalSupply }: {
  rows: TokenHolder[];
  labels: LabelMap;
  empty: string;
  maxRows?: number;
  totalSupply?: number | null;
}) {
  const visibleRows = enrichWalletRows(Array.isArray(rows) ? rows : [], labels).slice(0, maxRows);
  if (!visibleRows.length) return <EmptyBlock title="No wallet rows" body={empty} />;

  return (
    <div className="wallet-table" role="table" aria-label="Wallet rows">
      <div className="wallet-row wallet-row-head" role="row">
        <span>Wallet</span>
        <span>Type</span>
        <span>Amount</span>
        <span>Supply</span>
        <span>Relations</span>
      </div>
      {visibleRows.map((row) => {
        const address = walletAddress(row);
        const details = row.address_details || labels.get(address.toLowerCase())?.address_details;
        const label = details?.label || shortenAddress(address);
        const relations = details ? `${formatNumber(details.inward_relations)} in / ${formatNumber(details.outward_relations)} out` : 'No metadata';
        return (
          <div className="wallet-row" role="row" key={address}>
            <span className="wallet-address">
              <strong>{label}</strong>
              <small>{address ? shortenAddress(address) : 'wallet'}</small>
            </span>
            <strong>{walletTags({ ...row, address_details: details || row.address_details })}</strong>
            <span>{formatCompact(walletBalance(row))}</span>
            <span>{formatPercentPoints(holderSupplyPercent(row, totalSupply || null))}</span>
            <span>{relations}</span>
          </div>
        );
      })}
    </div>
  );
}
