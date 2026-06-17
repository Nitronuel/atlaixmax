import { Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { CoinGeckoCoin } from '../../shared/coingecko';
import { formatPrice, formatUsd } from './overview-utils';
import { CoinFeedService } from './coin-feed-service';
import { coinSearchText, openCoin } from './coin-feed-utils';

export function CoinSearch({ coins, query, onQueryChange }: {
  coins: CoinGeckoCoin[];
  query: string;
  onQueryChange: (value: string) => void;
}) {
  const [remoteSuggestions, setRemoteSuggestions] = useState<CoinGeckoCoin[]>([]);
  const normalized = query.trim().toLowerCase();
  const localSuggestions = useMemo(() => (
    normalized ? coins.filter((coin) => coinSearchText(coin).includes(normalized)).slice(0, 6) : []
  ), [coins, normalized]);
  const suggestions = normalized ? [...localSuggestions, ...remoteSuggestions.filter((coin) => !localSuggestions.some((local) => local.id === coin.id))].slice(0, 8) : [];

  useEffect(() => {
    if (normalized.length < 2) {
      setRemoteSuggestions([]);
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      CoinFeedService.search(query)
        .then((items) => {
          if (!controller.signal.aborted) setRemoteSuggestions(items.slice(0, 8));
        })
        .catch(() => {
          if (!controller.signal.aborted) setRemoteSuggestions([]);
        });
    }, 260);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [normalized, query]);

  function submit() {
    const first = suggestions[0];
    if (first) openCoin(first);
  }

  return (
    <section className="overview-search-wrap">
      <div className="overview-search">
        <Search size={23} />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && submit()}
          placeholder="Search coin name or symbol"
        />
      </div>
      <button type="button" className="overview-search-button" onClick={submit} aria-label="Open first coin search result">
        <Search size={24} />
      </button>
      {suggestions.length ? (
        <div className="overview-search-menu">
          {suggestions.map((coin) => (
            <button type="button" key={coin.id} onClick={() => openCoin(coin)}>
              <span className="overview-token-logo">{coin.image ? <img src={coin.image} alt="" /> : coin.symbol.slice(0, 2)}</span>
              <span><strong>{coin.symbol}</strong><small>{coin.name}</small></span>
              <em>{formatPrice(coin.priceUsd)} · {formatUsd(coin.marketCapUsd)}</em>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
