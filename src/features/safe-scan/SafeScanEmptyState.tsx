import type { FormEvent } from 'react';
import { Loader2, Search, Shield, ShieldAlert } from 'lucide-react';
import {
  type BubblemapsChain,
  BUBBLEMAPS_CHAINS
} from '../../shared/bubblemaps';
import { Card } from './ui';

export function SafeScanEmptyState({
  address,
  chain,
  loading,
  error,
  detectingNetwork,
  addressSupported,
  onAddressChange,
  onChainChange,
  onSubmit
}: {
  address: string;
  chain: BubblemapsChain;
  loading: boolean;
  error: string | null;
  detectingNetwork: boolean;
  addressSupported: boolean;
  onAddressChange: (address: string) => void;
  onChainChange: (chain: BubblemapsChain) => void;
  onSubmit: (event?: FormEvent) => void;
}) {
  const normalizedAddress = address.trim();

  return (
    <div className="safe-scan-empty">
      <form onSubmit={onSubmit} className="scan-form">
        <label>
          <span className="sr-only">Chain</span>
          <select value={chain} onChange={(event) => onChainChange(event.target.value as BubblemapsChain)} disabled={loading}>
            {BUBBLEMAPS_CHAINS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label className="address-field">
          <span className="sr-only">Token address</span>
          <div className="search-control">
            <Search size={20} />
            <input value={address} onChange={(event) => onAddressChange(event.target.value)} placeholder="Enter token contract address" disabled={loading} />
          </div>
        </label>
        <button type="submit" className="primary-button" disabled={loading || !normalizedAddress || (!addressSupported && !detectingNetwork)}>
          {loading ? <Loader2 size={20} className="spin" /> : <Shield size={20} />}
          {loading ? 'Analyzing...' : 'Analyze Distribution'}
        </button>
      </form>
      {detectingNetwork ? <div className="form-note">Detecting chain from address...</div> : null}
      {!addressSupported && !detectingNetwork ? <div className="form-error">{chain === 'solana' ? 'Solana scans require a valid Solana token address.' : chain === 'tron' ? 'Tron scans require a valid Tron token address.' : chain === 'ton' ? 'TON scans require a valid TON token address.' : 'EVM scans require a valid 0x token address.'}</div> : null}
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <Card className="analysis-card">
        <div className="analysis-icon">{loading ? <Loader2 size={36} className="spin" /> : <ShieldAlert size={36} />}</div>
        <h1>Distribution Analysis</h1>
        <p>Enter a token address to scan holder concentration, wallet clusters, supply exposure, and transfers.</p>
      </Card>
    </div>
  );
}
