create table if not exists public.coingecko_coins (
  coin_id text primary key,
  symbol text not null,
  name text not null,
  image_url text,
  market_cap_rank integer,
  price_usd numeric,
  market_cap_usd numeric,
  fdv_usd numeric,
  volume_24h_usd numeric,
  price_change_1h numeric,
  price_change_24h numeric,
  price_change_7d numeric,
  price_change_30d numeric,
  circulating_supply numeric,
  total_supply numeric,
  max_supply numeric,
  ath numeric,
  ath_change_percentage numeric,
  atl numeric,
  atl_change_percentage numeric,
  sparkline_7d jsonb not null default '[]'::jsonb,
  atlaix_event text not null default 'Unusual Activity',
  raw_data jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists coingecko_coins_rank_idx on public.coingecko_coins (market_cap_rank asc nulls last);
create index if not exists coingecko_coins_last_seen_idx on public.coingecko_coins (last_seen_at desc);
create index if not exists coingecko_coins_event_idx on public.coingecko_coins (atlaix_event);

create table if not exists public.coingecko_coin_snapshots (
  id uuid primary key default gen_random_uuid(),
  coin_id text not null references public.coingecko_coins (coin_id) on delete cascade,
  captured_at timestamptz not null default now(),
  price_usd numeric,
  market_cap_usd numeric,
  volume_24h_usd numeric,
  price_change_1h numeric,
  price_change_24h numeric,
  price_change_7d numeric,
  market_cap_rank integer
);

create index if not exists coingecko_coin_snapshots_coin_time_idx on public.coingecko_coin_snapshots (coin_id, captured_at desc);
create index if not exists coingecko_coin_snapshots_time_idx on public.coingecko_coin_snapshots (captured_at desc);

alter table public.coingecko_coins enable row level security;
alter table public.coingecko_coin_snapshots enable row level security;
