-- Per-user Telegram linking for Smart Alert delivery.

create table if not exists public.telegram_connections (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    telegram_chat_id text,
    telegram_user_id text,
    telegram_username text,
    link_token_hash text,
    link_token_expires_at timestamptz,
    connected_at timestamptz,
    disconnected_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists telegram_connections_active_user_idx
on public.telegram_connections (user_id)
where disconnected_at is null;

create index if not exists telegram_connections_link_token_idx
on public.telegram_connections (link_token_hash)
where link_token_hash is not null and disconnected_at is null;

drop trigger if exists telegram_connections_set_updated_at on public.telegram_connections;
create trigger telegram_connections_set_updated_at
before update on public.telegram_connections
for each row execute function public.set_updated_at();

alter table public.telegram_connections enable row level security;

drop policy if exists "Users can read own telegram connection" on public.telegram_connections;
create policy "Users can read own telegram connection" on public.telegram_connections
for select
using (auth.uid() = user_id);

-- Connection rows are created and updated by trusted backend routes with a service-role key.
