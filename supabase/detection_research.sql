create table if not exists public.detection_event_setups (
    event_id uuid primary key references public.detection_events(id) on delete cascade,
    classification_id uuid,
    token_id text not null references public.detection_tokens(token_id) on delete cascade,
    token_address text not null,
    pair_address text not null,
    chain text not null,
    dex_id text,
    event_label text not null,
    alert_timestamp timestamptz not null,
    rule_version text,
    confidence smallint,
    risk_level text,
    risk_score smallint,
    manipulation_risk_level text,
    manipulation_risk_score smallint,
    alert_priority text,
    confirmation_status text,
    confirmation_score smallint,
    classification_basis text,
    event_horizon text,
    dominant_timeframe text,
    structural_regime text,
    active_regime text,
    lower_timeframe_trigger text,
    trend_change text,
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
    volume_quality_score smallint,
    volume_quality_level text,
    liquidity_regime text,
    liquidity_state text,
    pressure_state text,
    price_momentum_score numeric,
    volatility_score numeric,
    consecutive_green_snapshots integer,
    consecutive_red_snapshots integer,
    consecutive_buy_dominant_snapshots integer,
    consecutive_sell_dominant_snapshots integer,
    trend_direction text,
    data_quality_score smallint,
    history_snapshots integer,
    pair_reliability_tier text,
    pair_reliability_score smallint,
    secondary_signals jsonb not null default '[]'::jsonb,
    contradictory_signals jsonb not null default '[]'::jsonb,
    warnings jsonb not null default '[]'::jsonb,
    context_summary jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists detection_event_setups_label_time_idx
on public.detection_event_setups (event_label, alert_timestamp desc);

create index if not exists detection_event_setups_token_time_idx
on public.detection_event_setups (token_id, alert_timestamp desc);

create index if not exists detection_event_setups_chain_time_idx
on public.detection_event_setups (chain, alert_timestamp desc);

create table if not exists public.detection_event_outcomes (
    event_id uuid primary key references public.detection_event_setups(event_id) on delete cascade,
    token_id text not null,
    scored_at timestamptz not null default timezone('utc', now()),
    outcome_status text not null default 'pending' check (outcome_status in ('pending', 'partial', 'complete', 'unresolved')),
    alert_price_usd numeric,
    alert_liquidity_usd numeric,
    price_15m numeric,
    price_1h numeric,
    price_3h numeric,
    price_6h numeric,
    price_12h numeric,
    price_24h numeric,
    return_15m_bps integer,
    return_1h_bps integer,
    return_3h_bps integer,
    return_6h_bps integer,
    return_12h_bps integer,
    return_24h_bps integer,
    liquidity_15m numeric,
    liquidity_1h numeric,
    liquidity_3h numeric,
    liquidity_6h numeric,
    liquidity_12h numeric,
    liquidity_24h numeric,
    liquidity_change_1h_bps integer,
    liquidity_change_6h_bps integer,
    liquidity_change_24h_bps integer,
    max_upside_24h_bps integer,
    max_drawdown_24h_bps integer,
    time_to_max_upside_minutes integer,
    time_to_max_drawdown_minutes integer,
    target_hit boolean,
    invalidation_hit boolean,
    result text check (result in ('win', 'loss', 'neutral', 'unresolved')),
    notes text,
    updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists detection_event_outcomes_status_idx
on public.detection_event_outcomes (outcome_status, scored_at desc);

create table if not exists public.detection_rollups (
    id uuid primary key default gen_random_uuid(),
    token_id text not null references public.detection_tokens(token_id) on delete cascade,
    bucket_start timestamptz not null,
    bucket_minutes integer not null,
    open_price_usd numeric,
    high_price_usd numeric,
    low_price_usd numeric,
    close_price_usd numeric,
    open_liquidity_usd numeric,
    close_liquidity_usd numeric,
    volume_usd numeric,
    buys integer,
    sells integer,
    max_upside_bps integer,
    max_drawdown_bps integer,
    created_at timestamptz not null default timezone('utc', now()),
    unique (token_id, bucket_start, bucket_minutes)
);

create index if not exists detection_rollups_token_bucket_idx
on public.detection_rollups (token_id, bucket_minutes, bucket_start desc);

create table if not exists public.market_context_hourly (
    context_hour timestamptz primary key,
    btc_return_1h_bps integer,
    eth_return_1h_bps integer,
    sol_return_1h_bps integer,
    market_regime text,
    volatility_score smallint,
    chain_context jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.backtest_runs (
    id uuid primary key default gen_random_uuid(),
    strategy_name text not null,
    rule_version text,
    started_at timestamptz not null default timezone('utc', now()),
    completed_at timestamptz,
    status text not null default 'running' check (status in ('running', 'success', 'error')),
    sample_size integer not null default 0,
    config jsonb not null default '{}'::jsonb,
    summary jsonb not null default '{}'::jsonb,
    error text
);

create table if not exists public.backtest_run_results (
    id uuid primary key default gen_random_uuid(),
    run_id uuid not null references public.backtest_runs(id) on delete cascade,
    event_label text not null,
    horizon text not null,
    sample_size integer not null default 0,
    win_rate_bps integer,
    average_return_bps integer,
    median_return_bps integer,
    average_drawdown_bps integer,
    summary jsonb not null default '{}'::jsonb
);

create index if not exists backtest_run_results_run_idx
on public.backtest_run_results (run_id);

alter table public.detection_event_setups enable row level security;
alter table public.detection_event_outcomes enable row level security;
alter table public.detection_rollups enable row level security;
alter table public.market_context_hourly enable row level security;
alter table public.backtest_runs enable row level security;
alter table public.backtest_run_results enable row level security;
