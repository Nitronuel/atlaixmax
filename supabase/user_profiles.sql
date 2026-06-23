-- Supabase auth/profile and personalization foundation for Atlaix Max.

create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    email text not null default '',
    display_name text not null default 'Atlaix User',
    avatar_url text,
    plan text not null default 'free' check (plan in ('free', 'pro', 'admin')),
    role text not null default 'user' check (role in ('user', 'admin')),
    onboarding_completed boolean not null default false,
    preferred_chain text not null default 'solana',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.watchlist_tokens (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    chain_id text not null,
    token_address text not null,
    pair_address text,
    symbol text,
    name text,
    image_url text,
    created_at timestamptz not null default now(),
    unique (user_id, chain_id, token_address)
);

create table if not exists public.tracked_wallets (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    chain_id text not null,
    wallet_address text not null,
    label text,
    created_at timestamptz not null default now(),
    unique (user_id, chain_id, wallet_address)
);

create table if not exists public.saved_filters (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    page text not null,
    name text not null,
    config jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.recent_tokens (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    chain_id text not null,
    token_address text not null,
    pair_address text,
    viewed_at timestamptz not null default now(),
    unique (user_id, chain_id, token_address)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create or replace function public.protect_profile_sensitive_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.role() = 'authenticated' then
        if tg_op = 'INSERT' then
            new.email = coalesce((select email from auth.users where id = auth.uid()), new.email, '');
            new.plan = 'free';
            new.role = 'user';
        elsif tg_op = 'UPDATE' then
            new.id = old.id;
            new.email = old.email;
            new.plan = old.plan;
            new.role = old.role;
            new.created_at = old.created_at;
        end if;
    end if;

    return new;
end;
$$;

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, email, display_name)
    values (
        new.id,
        coalesce(new.email, ''),
        coalesce(new.raw_user_meta_data->>'display_name', split_part(coalesce(new.email, ''), '@', 1), 'Atlaix User')
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists profiles_protect_sensitive_fields on public.profiles;
create trigger profiles_protect_sensitive_fields
before insert or update on public.profiles
for each row execute function public.protect_profile_sensitive_fields();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists saved_filters_set_updated_at on public.saved_filters;
create trigger saved_filters_set_updated_at
before update on public.saved_filters
for each row execute function public.set_updated_at();

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.handle_new_user_profile();

alter table public.profiles enable row level security;
alter table public.watchlist_tokens enable row level security;
alter table public.tracked_wallets enable row level security;
alter table public.saved_filters enable row level security;
alter table public.recent_tokens enable row level security;

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile" on public.profiles
for select using (auth.uid() = id);

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile" on public.profiles
for insert with check (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles
for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "Users own watchlist tokens" on public.watchlist_tokens;
create policy "Users own watchlist tokens" on public.watchlist_tokens
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users own tracked wallets" on public.tracked_wallets;
create policy "Users own tracked wallets" on public.tracked_wallets
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users own saved filters" on public.saved_filters;
create policy "Users own saved filters" on public.saved_filters
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users own recent tokens" on public.recent_tokens;
create policy "Users own recent tokens" on public.recent_tokens
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
