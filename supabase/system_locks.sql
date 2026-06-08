create table if not exists public.system_locks (
    name text primary key,
    owner text not null,
    expires_at timestamptz not null,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists system_locks_expires_at_idx
    on public.system_locks (expires_at);

create or replace function public.try_acquire_system_lock(
    lock_name text,
    lock_owner text,
    ttl_seconds integer
)
returns boolean
language plpgsql
security definer
as $$
declare
    acquired boolean := false;
begin
    insert into public.system_locks (name, owner, expires_at)
    values (
        lock_name,
        lock_owner,
        timezone('utc', now()) + make_interval(secs => greatest(ttl_seconds, 1))
    )
    on conflict (name)
    do update set
        owner = excluded.owner,
        expires_at = excluded.expires_at,
        updated_at = timezone('utc', now())
    where public.system_locks.expires_at <= timezone('utc', now())
    returning true into acquired;

    return coalesce(acquired, false);
end;
$$;

create or replace function public.release_system_lock(
    lock_name text,
    lock_owner text
)
returns boolean
language plpgsql
security definer
as $$
declare
    released boolean := false;
begin
    delete from public.system_locks
    where name = lock_name
      and owner = lock_owner
    returning true into released;

    return coalesce(released, false);
end;
$$;

alter table public.system_locks enable row level security;
