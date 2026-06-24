-- Watchlist Intelligence Workspace persistence.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create table if not exists public.watchlist_assets (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    asset_type text not null check (asset_type in ('token', 'coin')),
    chain_id text,
    token_address text,
    pair_address text,
    coin_id text,
    symbol text not null default '',
    name text not null default '',
    image_url text,
    price_usd numeric,
    price_change_24h numeric,
    liquidity_usd numeric,
    risk_level text,
    state text,
    last_event_type text,
    last_event_at timestamptz,
    monitor_settings jsonb not null default '{
        "detectionEvents": true,
        "safeScanChanges": false,
        "liquidityChanges": false,
        "riskChanges": true,
        "aiStateChanges": true,
        "majorVolumeEvents": true
    }'::jsonb,
    last_snapshot jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint watchlist_asset_identity check (
        (asset_type = 'token' and chain_id is not null and token_address is not null)
        or
        (asset_type = 'coin' and coin_id is not null)
    )
);

create unique index if not exists watchlist_assets_token_unique
on public.watchlist_assets (user_id, chain_id, lower(token_address))
where asset_type = 'token';

create unique index if not exists watchlist_assets_coin_unique
on public.watchlist_assets (user_id, lower(coin_id))
where asset_type = 'coin';

drop trigger if exists watchlist_assets_set_updated_at on public.watchlist_assets;
create trigger watchlist_assets_set_updated_at
before update on public.watchlist_assets
for each row execute function public.set_updated_at();

alter table public.watchlist_assets enable row level security;

drop policy if exists "Users own watchlist assets" on public.watchlist_assets;
create policy "Users own watchlist assets" on public.watchlist_assets
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
