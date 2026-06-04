import type { FormEvent } from 'react';
import { Loader2, Search, Shield, ShieldAlert } from 'lucide-react';
import {
  type InsightXNetwork,
  getInsightXNetworkLabel,
  INSIGHTX_NETWORKS
} from '../../shared/insightx';
import type { DetectedTokenNetwork } from './safe-scan-service';
import { Card } from './ui';

export function SafeScanEmptyState({
  address,
  network,
  loading,
  error,
  detectedNetwork,
  detectingNetwork,
  addressSupported,
  onAddressChange,
  onNetworkChange,
  onSubmit
}: {
  address: string;
  network: InsightXNetwork;
  loading: boolean;
  error: string | null;
  detectedNetwork: DetectedTokenNetwork | null;
  detectingNetwork: boolean;
  addressSupported: boolean;
  onAddressChange: (address: string) => void;
  onNetworkChange: (network: InsightXNetwork) => void;
  onSubmit: (event?: FormEvent) => void;
}) {
  const normalizedAddress = address.trim();

  return (
    <div className="safe-scan-empty">
      <form onSubmit={onSubmit} className="scan-form">
        <label>
          <span className="sr-only">Network</span>
          <select value={network} onChange={(event) => onNetworkChange(event.target.value as InsightXNetwork)} disabled={loading}>
            {INSIGHTX_NETWORKS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label className="address-field">
          <span className="sr-only">Token address</span>
          <div className="search-control">
            <Search size={20} />
            <input value={address} onChange={(event) => onAddressChange(event.target.value)} placeholder="Enter Token Contract Address" disabled={loading} />
          </div>
        </label>
        <button type="submit" className="primary-button" disabled={loading || !normalizedAddress || !addressSupported}>
          {loading ? <Loader2 size={20} className="spin" /> : <Shield size={20} />}
          {loading ? 'Scanning...' : 'Safety Scan'}
        </button>
      </form>
      {detectingNetwork ? <div className="form-note">Detecting network from address...</div> : null}
      {detectedNetwork ? <div className="form-note">Detected {getInsightXNetworkLabel(detectedNetwork.network)} from {detectedNetwork.source}.</div> : null}
      {!addressSupported ? <div className="form-error">{network === 'sol' ? 'Solana scans require a valid Solana address.' : network === 'sui' ? 'Sui scans require a valid Sui token address.' : 'EVM scans require a valid 0x token address.'}</div> : null}
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <Card className="analysis-card">
        <div className="analysis-icon">{loading ? <Loader2 size={36} className="spin" /> : <ShieldAlert size={36} />}</div>
        <h1>Security Analysis</h1>
        <p>Enter a token address to check contract flags, holders, launch wallets, and known labels.</p>
      </Card>
    </div>
  );
}
