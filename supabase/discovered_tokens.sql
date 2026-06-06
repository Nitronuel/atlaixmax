create table if not exists public.discovered_tokens (
    address text not null,
    chain text not null,
    ticker text not null,
    name text,
    price text,
    liquidity text,
    volume_24h text,
    last_seen_at timestamptz not null default timezone('utc', now()),
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    raw_data jsonb not null,
    constraint discovered_tokens_address_chain_key unique (address, chain)
);

create index if not exists discovered_tokens_last_seen_idx
    on public.discovered_tokens (last_seen_at desc);

create index if not exists discovered_tokens_chain_last_seen_idx
    on public.discovered_tokens (chain, last_seen_at desc);

create index if not exists discovered_tokens_ticker_idx
    on public.discovered_tokens (ticker);

create or replace function public.alpha_compact_usd_to_numeric(value text)
returns numeric
language plpgsql
immutable
as $$
declare
    cleaned text;
    multiplier numeric := 1;
    parsed numeric;
begin
    if value is null or btrim(value) = '' then
        return 0;
    end if;

    cleaned := upper(regexp_replace(value, '[$,%\s,]', '', 'g'));

    if cleaned like '%T' then
        multiplier := 1000000000000;
    elsif cleaned like '%B' then
        multiplier := 1000000000;
    elsif cleaned like '%M' then
        multiplier := 1000000;
    elsif cleaned like '%K' then
        multiplier := 1000;
    end if;

    cleaned := regexp_replace(cleaned, '[TBMK]', '', 'g');

    begin
        parsed := cleaned::numeric;
    exception when others then
        return 0;
    end;

    return parsed * multiplier;
end;
$$;

alter table public.discovered_tokens
    drop constraint if exists discovered_tokens_min_liquidity_check;

alter table public.discovered_tokens
    add constraint discovered_tokens_min_liquidity_check
    check (public.alpha_compact_usd_to_numeric(liquidity) >= 100000);

create or replace function public.set_discovered_tokens_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = timezone('utc', now());
    return new;
end;
$$;

drop trigger if exists discovered_tokens_set_updated_at on public.discovered_tokens;

create trigger discovered_tokens_set_updated_at
before update on public.discovered_tokens
for each row
execute function public.set_discovered_tokens_updated_at();

alter table public.discovered_tokens enable row level security;
