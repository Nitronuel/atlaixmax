-- Smart Alerts persistence, trigger history, and secure user ownership policies.

create table if not exists public.alert_rules (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    alert_type text not null check (alert_type in ('Price', 'Volume', 'Liquidity', 'Whale', 'Alpha', 'Risk', 'Detection')),
    target text not null default 'Any token',
    chain_id text not null default 'solana',
    token_address text,
    condition text not null,
    threshold_kind text not null default 'currency' check (threshold_kind in ('currency', 'percent', 'event', 'severity')),
    threshold text not null,
    trigger_label text not null,
    notification_channels text[] not null default array['in_app']::text[],
    cooldown_minutes integer not null default 60 check (cooldown_minutes between 1 and 10080),
    enabled boolean not null default true,
    last_checked_at timestamptz,
    last_triggered_at timestamptz,
    last_observed_value text,
    last_observed_at timestamptz,
    baseline_value numeric,
    baseline_observed_at timestamptz,
    trigger_count integer not null default 0,
    last_error text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.alert_rules
add column if not exists threshold_kind text not null default 'currency' check (threshold_kind in ('currency', 'percent', 'event', 'severity'));

alter table public.alert_rules
add column if not exists last_checked_at timestamptz;

alter table public.alert_rules
add column if not exists last_observed_value text;

alter table public.alert_rules
add column if not exists last_observed_at timestamptz;

alter table public.alert_rules
add column if not exists baseline_value numeric;

alter table public.alert_rules
add column if not exists baseline_observed_at timestamptz;

alter table public.alert_rules
add column if not exists trigger_count integer not null default 0;

alter table public.alert_rules
add column if not exists last_error text;

alter table public.alert_rules
add column if not exists metadata jsonb not null default '{}'::jsonb;

do $$
begin
    alter table public.alert_rules drop constraint if exists alert_rules_alert_type_check;
    alter table public.alert_rules
    add constraint alert_rules_alert_type_check
    check (alert_type in ('Price', 'Volume', 'Liquidity', 'Whale', 'Alpha', 'Risk', 'Detection'));
end $$;

create table if not exists public.alert_triggers (
    id uuid primary key default gen_random_uuid(),
    alert_rule_id uuid references public.alert_rules(id) on delete set null,
    user_id uuid not null references auth.users(id) on delete cascade,
    alert_type text not null check (alert_type in ('Price', 'Volume', 'Liquidity', 'Whale', 'Alpha', 'Risk', 'Detection')),
    title text not null,
    message text not null,
    observed_value text,
    threshold text,
    source text not null default 'system',
    dedupe_key text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
);

alter table public.alert_triggers
add column if not exists metadata jsonb not null default '{}'::jsonb;

do $$
begin
    alter table public.alert_triggers drop constraint if exists alert_triggers_alert_type_check;
    alter table public.alert_triggers
    add constraint alert_triggers_alert_type_check
    check (alert_type in ('Price', 'Volume', 'Liquidity', 'Whale', 'Alpha', 'Risk', 'Detection'));
end $$;

create index if not exists alert_rules_user_created_idx
on public.alert_rules (user_id, created_at desc);

create index if not exists alert_rules_enabled_type_idx
on public.alert_rules (enabled, alert_type, chain_id);

create index if not exists alert_rules_enabled_checked_idx
on public.alert_rules (enabled, last_checked_at nulls first, created_at desc);

create index if not exists alert_triggers_user_created_idx
on public.alert_triggers (user_id, created_at desc);

create unique index if not exists alert_triggers_dedupe_idx
on public.alert_triggers (user_id, dedupe_key)
where dedupe_key is not null;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists alert_rules_set_updated_at on public.alert_rules;
create trigger alert_rules_set_updated_at
before update on public.alert_rules
for each row execute function public.set_updated_at();

alter table public.alert_rules enable row level security;
alter table public.alert_triggers enable row level security;

drop policy if exists "Users own alert rules" on public.alert_rules;
create policy "Users own alert rules" on public.alert_rules
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can read own alert triggers" on public.alert_triggers;
create policy "Users can read own alert triggers" on public.alert_triggers
for select
using (auth.uid() = user_id);

-- Trigger rows are written by trusted backend jobs with a service-role key.
-- Users can read their own history, but client-side writes are intentionally blocked.
