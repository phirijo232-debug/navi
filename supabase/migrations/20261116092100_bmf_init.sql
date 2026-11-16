-- BMF practice database. No sample rows.
-- The Node server uses the service role key. The browser never does.
-- Row Level Security is on and there are no policies, so the anon and
-- authenticated API roles cannot read or write these tables.

create table if not exists public.documents (
  key text primary key,
  body jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.sessions (
  token_hash text primary key,
  email text not null,
  user_id text,
  jti text not null,
  expires_at timestamptz not null,
  revoked boolean not null default false,
  ip text,
  last_seen timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists sessions_email_idx on public.sessions (email);

create table if not exists public.otps (
  otp_key text primary key,
  code_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.invites (
  token_hash text primary key,
  email text not null,
  expires_at timestamptz not null,
  used boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 1,
  primary key (bucket, window_start)
);

create table if not exists public.upload_links (
  jti text primary key,
  filename text not null,
  email text not null,
  expires_at timestamptz not null,
  revoked boolean not null default false
);

alter table public.documents enable row level security;
alter table public.sessions enable row level security;
alter table public.otps enable row level security;
alter table public.invites enable row level security;
alter table public.rate_limits enable row level security;
alter table public.upload_links enable row level security;

revoke all on table public.documents from anon, authenticated;
revoke all on table public.sessions from anon, authenticated;
revoke all on table public.otps from anon, authenticated;
revoke all on table public.invites from anon, authenticated;
revoke all on table public.rate_limits from anon, authenticated;
revoke all on table public.upload_links from anon, authenticated;

grant all on table public.documents to service_role;
grant all on table public.sessions to service_role;
grant all on table public.otps to service_role;
grant all on table public.invites to service_role;
grant all on table public.rate_limits to service_role;
grant all on table public.upload_links to service_role;

create or replace function public.bump_rate_limit(p_bucket text, p_window_seconds integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  win timestamptz;
  result integer;
begin
  if p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'window seconds must be positive';
  end if;
  win := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limits as row (bucket, window_start, hits)
  values (p_bucket, win, 1)
  on conflict (bucket, window_start)
  do update set hits = row.hits + 1
  returning hits into result;
  return result;
end;
$$;

revoke all on function public.bump_rate_limit(text, integer) from public, anon, authenticated;
grant execute on function public.bump_rate_limit(text, integer) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'bmf-uploads',
  'bmf-uploads',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- storage.objects already has RLS in Supabase. Do not add a public policy.
