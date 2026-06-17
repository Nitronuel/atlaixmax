import { RotateCcw, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { OverviewToken } from '../../shared/overview';
import type { FeedMode } from './FeedModeSwitch';
import { DEFAULT_OVERVIEW_FILTERS, type OverviewFilters } from './overview-utils';

function FilterSelect({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="overview-filter-row">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function FilterRange({ label, minValue, maxValue, suffix, onMinChange, onMaxChange }: {
  label: string;
  minValue: string;
  maxValue: string;
  suffix: string;
  onMinChange: (value: string) => void;
  onMaxChange: (value: string) => void;
}) {
  return (
    <div className="overview-filter-row">
      <span>{label}</span>
      <div className="overview-filter-range">
        <input value={minValue} onChange={(event) => onMinChange(event.target.value)} placeholder="Min" inputMode="decimal" />
        <small>{suffix}</small>
        <input value={maxValue} onChange={(event) => onMaxChange(event.target.value)} placeholder="Max" inputMode="decimal" />
      </div>
    </div>
  );
}

export function OverviewFiltersModal({ open, filters, tokens, eventOptions, mode = 'tokens', onClose, onApply }: {
  open: boolean;
  filters: OverviewFilters;
  tokens: OverviewToken[];
  eventOptions: string[];
  mode?: FeedMode;
  onClose: () => void;
  onApply: (filters: OverviewFilters) => void;
}) {
  const [draft, setDraft] = useState(filters);
  const chainOptions = useMemo(() => [...new Set(tokens.map((token) => token.chain))].sort(), [tokens]);

  useEffect(() => {
    if (open) setDraft(filters);
  }, [filters, open]);

  if (!open) return null;

  function update(key: keyof OverviewFilters, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="overview-filter-modal" role="dialog" aria-modal="true" aria-label="Live Alpha Feed filters">
      <div className="overview-filter-panel">
        <header>
          <h2>Filters</h2>
          <button type="button" onClick={onClose} aria-label="Close filters"><X size={21} /></button>
        </header>
        <div className="overview-filter-body">
          <FilterSelect label={mode === 'coins' ? 'Visible coins' : 'Visible tokens'} value={draft.visibleCount} onChange={(value) => update('visibleCount', value)} options={[
            { value: '50', label: 'Show 50' },
            { value: '100', label: 'Show 100' },
            { value: '200', label: 'Show 200' },
            { value: 'all', label: 'Show all' }
          ]} />
          {mode === 'tokens' ? (
            <FilterSelect label="Chain" value={draft.chain} onChange={(value) => update('chain', value)} options={[
              { value: 'all', label: 'All chains' },
              ...chainOptions.map((chain) => ({ value: chain, label: chain }))
            ]} />
          ) : null}
          <FilterSelect label="Event" value={draft.event} onChange={(value) => update('event', value)} options={[
            { value: 'all', label: 'All events' },
            ...eventOptions.map((event) => ({ value: event, label: event }))
          ]} />
          <FilterRange label="Market cap" suffix="$" minValue={draft.marketCapMin} maxValue={draft.marketCapMax} onMinChange={(value) => update('marketCapMin', value)} onMaxChange={(value) => update('marketCapMax', value)} />
          {mode === 'tokens' ? (
            <FilterRange label="Liquidity" suffix="$" minValue={draft.liquidityMin} maxValue={draft.liquidityMax} onMinChange={(value) => update('liquidityMin', value)} onMaxChange={(value) => update('liquidityMax', value)} />
          ) : null}
          <FilterRange label="24h change" suffix="%" minValue={draft.changeMin} maxValue={draft.changeMax} onMinChange={(value) => update('changeMin', value)} onMaxChange={(value) => update('changeMax', value)} />
          <FilterRange label={mode === 'coins' ? '24h volume' : 'DEX volume'} suffix="$" minValue={draft.volumeMin} maxValue={draft.volumeMax} onMinChange={(value) => update('volumeMin', value)} onMaxChange={(value) => update('volumeMax', value)} />
        </div>
        <footer>
          <button type="button" className="overview-filter-reset" onClick={() => setDraft(DEFAULT_OVERVIEW_FILTERS)}>
            <RotateCcw size={16} /> Reset
          </button>
          <button type="button" className="primary-button compact" onClick={() => onApply(draft)}>Apply</button>
        </footer>
      </div>
    </div>
  );
}
