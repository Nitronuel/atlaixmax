-- Private beta applications and invitation state.

create table if not exists public.beta_applications (
    id uuid primary key default gen_random_uuid(),
    full_name text not null check (char_length(trim(full_name)) between 2 and 120),
    email text not null check (email = lower(email) and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    x_username text,
    telegram_username text,
    intended_use text,
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'registered')),
    invite_token_hash text unique,
    invite_expires_at timestamptz,
    invite_sent_at timestamptz,
    approved_at timestamptz,
    rejected_at timestamptz,
    registered_at timestamptz,
    registered_user_id uuid references auth.users(id) on delete set null,
    reviewed_by uuid references auth.users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (email)
);

create index if not exists beta_applications_status_created_idx
on public.beta_applications (status, created_at desc);

create index if not exists beta_applications_invite_token_hash_idx
on public.beta_applications (invite_token_hash)
where invite_token_hash is not null;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists beta_applications_set_updated_at on public.beta_applications;
create trigger beta_applications_set_updated_at
before update on public.beta_applications
for each row execute function public.set_updated_at();

alter table public.beta_applications enable row level security;

-- Applications are managed through trusted backend routes with the service-role key.
drop policy if exists "No direct beta application access" on public.beta_applications;
