-- Smart Money wallet registry.
-- Wallets are promoted here only after Wallet Tracker qualification.

create table if not exists public.smart_money_wallets (
  wallet_address text primary key,
  name text not null,
  categories text[] not null default array['Smart Money']::text[],
  chain text not null default 'All Chains',
  last_balance text,
  last_win_rate text,
  last_pnl text,
  smart_money_score integer not null default 0,
  qualification jsonb,
  source text not null default 'wallet-tracker',
  promotion_scope text not null default 'global',
  last_verified_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.smart_money_wallets
  add column if not exists chain text not null default 'All Chains',
  add column if not exists promotion_scope text not null default 'global',
  add column if not exists last_verified_at timestamptz;

create index if not exists smart_money_wallets_score_idx
  on public.smart_money_wallets (smart_money_score desc, updated_at desc);

create table if not exists public.smart_money_exclusions (
  wallet_address text primary key,
  reason text,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.smart_money_wallets enable row level security;
alter table public.smart_money_exclusions enable row level security;

drop policy if exists "Public can read smart money wallets" on public.smart_money_wallets;
create policy "Public can read smart money wallets"
  on public.smart_money_wallets
  for select
  using (true);

drop policy if exists "Public can read smart money exclusions" on public.smart_money_exclusions;
create policy "Public can read smart money exclusions"
  on public.smart_money_exclusions
  for select
  using (true);

create or replace function public.set_smart_money_wallets_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists smart_money_wallets_set_updated_at on public.smart_money_wallets;
create trigger smart_money_wallets_set_updated_at
before update on public.smart_money_wallets
for each row
execute function public.set_smart_money_wallets_updated_at();
