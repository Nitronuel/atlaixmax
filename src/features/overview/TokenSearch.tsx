import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { OverviewToken } from '../../shared/overview';
import { formatPercentValue, formatPrice, formatUsd, openToken, tokenSearchText } from './overview-utils';
import { OverviewService } from './overview-service';

const SEARCH_MENU_LIMIT = 40;

export function TokenSearch({ tokens, query, onQueryChange }: {
  tokens: OverviewToken[];
  query: string;
  onQueryChange: (query: string) => void;
}) {
  const [remoteSuggestions, setRemoteSuggestions] = useState<OverviewToken[]>([]);
  const [open, setOpen] = useState(false);
  const trimmed = query.trim().toLowerCase();
  const localSuggestions = trimmed
    ? tokens.filter((token) => tokenSearchText(token).includes(trimmed)).slice(0, 6)
    : [];
  const suggestions = [...localSuggestions, ...remoteSuggestions.filter((remote) => !localSuggestions.some((local) => local.id === remote.id))].slice(0, SEARCH_MENU_LIMIT);

  useEffect(() => {
    if (query.trim().length < 2) {
      setRemoteSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      OverviewService.search(query)
        .then((results) => {
          if (!cancelled) setRemoteSuggestions(results);
        })
        .catch(() => {
          if (!cancelled) setRemoteSuggestions([]);
        });
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  function submit() {
    const target = suggestions[0];
    if (target) openToken(target);
  }

  return (
    <section className="overview-search-wrap">
      <div className="overview-search">
        <Search size={18} />
        <input
          value={query}
          onChange={(event) => {
            onQueryChange(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 160)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
          }}
          placeholder="Search token name, ticker, or contract"
        />
      </div>
      <button type="button" className="overview-search-button" onClick={submit} aria-label="Open first search result">
        <Search size={18} />
      </button>
      {open && suggestions.length ? (
        <div className="overview-search-menu">
          {suggestions.map((token) => (
            <button type="button" key={token.id} onMouseDown={(event) => event.preventDefault()} onClick={() => openToken(token)}>
              <span className="overview-token-logo">{token.logo ? <img src={token.logo} alt="" /> : token.symbol.slice(0, 2)}</span>
              <span>
                <strong>{token.symbol}</strong>
                <small>{token.name}</small>
              </span>
              <span><small>MCap</small><b>{formatUsd(token.marketCapUsd)}</b></span>
              <span><small>Liq</small><b>{formatUsd(token.liquidityUsd)}</b></span>
              <span><small>Price</small><b>{formatPrice(token.priceUsd)}</b></span>
              <em className={Number(token.change24h) >= 0 ? 'positive' : 'negative'}>{formatPercentValue(token.change24h)}</em>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
