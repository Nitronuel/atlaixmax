-- Feedback inbox and support conversation persistence.

create table if not exists public.feedback_threads (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    user_email text not null default '',
    user_name text not null default 'Atlaix User',
    subject text not null default 'Feedback',
    category text not null default 'General',
    status text not null default 'open' check (status in ('open', 'waiting_admin', 'waiting_user', 'resolved')),
    source_path text,
    last_message_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.feedback_messages (
    id uuid primary key default gen_random_uuid(),
    thread_id uuid not null references public.feedback_threads(id) on delete cascade,
    sender_id uuid not null references auth.users(id) on delete cascade,
    sender_role text not null check (sender_role in ('user', 'admin')),
    sender_email text not null default '',
    message text not null,
    email_sent_at timestamptz,
    email_error text,
    created_at timestamptz not null default now()
);

create index if not exists feedback_threads_user_updated_idx
on public.feedback_threads (user_id, last_message_at desc);

create index if not exists feedback_threads_status_updated_idx
on public.feedback_threads (status, last_message_at desc);

create index if not exists feedback_messages_thread_created_idx
on public.feedback_messages (thread_id, created_at asc);

drop trigger if exists feedback_threads_set_updated_at on public.feedback_threads;
create trigger feedback_threads_set_updated_at
before update on public.feedback_threads
for each row execute function public.set_updated_at();

alter table public.feedback_threads enable row level security;
alter table public.feedback_messages enable row level security;

drop policy if exists "Users can read own feedback threads" on public.feedback_threads;
create policy "Users can read own feedback threads" on public.feedback_threads
for select using (auth.uid() = user_id);

drop policy if exists "Users can insert own feedback threads" on public.feedback_threads;
create policy "Users can insert own feedback threads" on public.feedback_threads
for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update own feedback threads" on public.feedback_threads;
create policy "Users can update own feedback threads" on public.feedback_threads
for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can read own feedback messages" on public.feedback_messages;
create policy "Users can read own feedback messages" on public.feedback_messages
for select using (
    exists (
        select 1 from public.feedback_threads
        where feedback_threads.id = feedback_messages.thread_id
        and feedback_threads.user_id = auth.uid()
    )
);

drop policy if exists "Users can insert own feedback messages" on public.feedback_messages;
create policy "Users can insert own feedback messages" on public.feedback_messages
for insert with check (
    exists (
        select 1 from public.feedback_threads
        where feedback_threads.id = feedback_messages.thread_id
        and feedback_threads.user_id = auth.uid()
    )
);

-- Admin reads and replies go through the trusted backend service-role API.
