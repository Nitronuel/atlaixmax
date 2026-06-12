create table if not exists public.detection_tokens (
    token_id text primary key,
    token_name text,
    token_symbol text,
    token_address text not null,
    chain text not null,
    pair_address text not null,
    dex_id text,
    pair_url text,
    logo_url text,
    overview_event text,
    overview_volume_24h numeric,
    overview_liquidity numeric,
    last_detection_checked_at timestamptz,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    unique (chain, token_address, pair_address)
);

create index if not exists detection_tokens_chain_address_idx
on public.detection_tokens (chain, token_address);

create index if not exists detection_tokens_checked_idx
on public.detection_tokens (last_detection_checked_at nulls first);

create table if not exists public.detection_snapshots (
    snapshot_id uuid primary key default gen_random_uuid(),
    token_id text not null references public.detection_tokens(token_id) on delete cascade,
    timestamp timestamptz not null,
    price_usd numeric,
    market_cap numeric,
    liquidity_usd numeric,
    volume_5m numeric,
    volume_1h numeric,
    volume_6h numeric,
    volume_24h numeric,
    buys_5m integer,
    sells_5m integer,
    traders_5m integer,
    price_change_5m numeric,
    price_change_1h numeric,
    price_change_6h numeric,
    price_change_24h numeric,
    raw jsonb not null default '{}'::jsonb
);

create index if not exists detection_snapshots_token_time_idx
on public.detection_snapshots (token_id, timestamp desc);

create table if not exists public.detection_features (
    feature_id uuid primary key default gen_random_uuid(),
    token_id text not null references public.detection_tokens(token_id) on delete cascade,
    timestamp timestamptz not null,
    total_txns_5m integer,
    buy_sell_ratio numeric,
    buy_txn_dominance numeric,
    sell_txn_dominance numeric,
    net_txn_pressure numeric,
    liquidity_change_percentage numeric,
    liquidity_change_usd numeric,
    volume_to_liquidity_ratio numeric,
    volume_spike_score numeric,
    volume_spike_persisted_snapshots integer,
    volume_quality_score numeric,
    volume_quality_level text,
    liquidity_regime text,
    price_momentum_score numeric,
    volatility_score numeric,
    consecutive_green_snapshots integer,
    consecutive_red_snapshots integer,
    consecutive_buy_dominant_snapshots integer,
    consecutive_sell_dominant_snapshots integer,
    trend_direction text,
    liquidity_state text,
    pressure_state text
);

create index if not exists detection_features_token_time_idx
on public.detection_features (token_id, timestamp desc);

create table if not exists public.detection_classifications (
    classification_id uuid primary key default gen_random_uuid(),
    token_id text not null references public.detection_tokens(token_id) on delete cascade,
    timestamp timestamptz not null,
    rule_label text not null,
    rule_confidence integer not null,
    final_label text not null,
    final_confidence integer not null,
    risk_level text not null,
    reason text not null,
    primary_label text,
    display_label text,
    market_phase text,
    structural_regime text,
    active_regime text,
    dominant_timeframe text,
    dominant_reason text,
    lower_timeframe_trigger text,
    timeframe_alignment jsonb,
    trend_change text,
    event_status text,
    confidence_breakdown jsonb,
    risk jsonb,
    manipulation_risk jsonb,
    timeframe_scores jsonb,
    liquidity_regime text,
    volume_quality jsonb,
    alert_priority text,
    secondary_signals jsonb,
    contradictory_signals jsonb,
    warnings jsonb,
    evidence jsonb,
    detector_scores jsonb,
    data_quality jsonb,
    rule_version text
);

create index if not exists detection_classifications_token_time_idx
on public.detection_classifications (token_id, timestamp desc);

create table if not exists public.detection_events (
    id uuid primary key default gen_random_uuid(),
    token_id text not null references public.detection_tokens(token_id) on delete cascade,
    classification_id uuid references public.detection_classifications(classification_id) on delete set null,
    event_type text not null,
    summary text not null,
    sentiment text not null check (sentiment in ('bullish', 'bearish', 'neutral')),
    severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
    score integer not null,
    detected_at timestamptz not null,
    token jsonb not null,
    metrics jsonb not null,
    dedupe_key text not null,
    created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists detection_events_dedupe_idx
on public.detection_events (dedupe_key);

create index if not exists detection_events_detected_idx
on public.detection_events (detected_at desc);

create index if not exists detection_events_severity_idx
on public.detection_events (severity);

create index if not exists detection_events_sentiment_idx
on public.detection_events (sentiment);

create table if not exists public.detection_runs (
    id uuid primary key default gen_random_uuid(),
    started_at timestamptz not null,
    completed_at timestamptz,
    status text not null check (status in ('running', 'success', 'error', 'skipped')),
    scanned_count integer not null default 0,
    classified_count integer not null default 0,
    failed_count integer not null default 0,
    event_count integer not null default 0,
    error text,
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists detection_runs_started_idx
on public.detection_runs (started_at desc);

create or replace function public.set_detection_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = timezone('utc', now());
    return new;
end;
$$;

drop trigger if exists detection_tokens_set_updated_at on public.detection_tokens;
create trigger detection_tokens_set_updated_at
before update on public.detection_tokens
for each row execute function public.set_detection_updated_at();

alter table public.detection_tokens enable row level security;
alter table public.detection_snapshots enable row level security;
alter table public.detection_features enable row level security;
alter table public.detection_classifications enable row level security;
alter table public.detection_events enable row level security;
alter table public.detection_runs enable row level security;
