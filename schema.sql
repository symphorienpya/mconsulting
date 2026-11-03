create table if not exists public.requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  company text,
  service text not null,
  budget text,
  message text,
  status text not null default 'Nouvelle demande',
  created_at timestamptz default now()
);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.requests(id) on delete cascade,
  type text not null,
  description text not null,
  created_at timestamptz default now()
);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text,
  email text,
  phone text,
  role text,
  notes text,
  created_at timestamptz default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  client text,
  category text,
  status text not null default 'Planifié',
  progress integer not null default 0 check (progress between 0 and 100),
  description text,
  created_at timestamptz default now()
);

create index if not exists requests_created_at_idx on public.requests (created_at desc);
create index if not exists activities_created_at_idx on public.activities (created_at desc);
create index if not exists activities_request_id_idx on public.activities (request_id);
create index if not exists contacts_created_at_idx on public.contacts (created_at desc);
create index if not exists projects_created_at_idx on public.projects (created_at desc);

insert into public.activities (request_id, type, description, created_at)
select r.id, 'booking_created', 'Demande existante importée dans l''historique', r.created_at
from public.requests r
where not exists (select 1 from public.activities a where a.request_id = r.id);

alter table public.requests enable row level security;
alter table public.activities enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'requests' and policyname = 'public can create requests') then
    create policy "public can create requests" on public.requests for insert to anon with check (true);
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'activities' and policyname = 'public can view activities') then
    create policy "public can view activities" on public.activities for select to anon using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'activities'
  ) then
    alter publication supabase_realtime add table public.activities;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'requests' and policyname = 'public can view recent requests') then
    create policy "public can view recent requests" on public.requests for select to anon using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'requests'
  ) then
    alter publication supabase_realtime add table public.requests;
  end if;
end $$;

alter table public.contacts enable row level security;
alter table public.projects enable row level security;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='contacts') then alter publication supabase_realtime add table public.contacts; end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='projects') then alter publication supabase_realtime add table public.projects; end if;
end $$;

notify pgrst, 'reload schema';
