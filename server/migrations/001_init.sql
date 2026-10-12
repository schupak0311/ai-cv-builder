create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);
create unique index users_email_key on users (lower(email));

create table sessions (
  token_hash text primary key,
  user_id uuid not null references users (id) on delete cascade,
  expires_at timestamptz not null
);
create index sessions_user_id_idx on sessions (user_id);

create table cvs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users (id) on delete cascade,
  target_role text not null,
  source_kind text not null check (source_kind in ('text', 'pdf')),
  source_text text not null,
  content jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index cvs_owner_id_idx on cvs (owner_id, created_at desc);

create table questions (
  id uuid primary key default gen_random_uuid(),
  cv_id uuid not null references cvs (id) on delete cascade,
  section text not null,
  text text not null,
  answer text,
  created_at timestamptz not null default now(),
  answered_at timestamptz
);
create index questions_cv_id_idx on questions (cv_id);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  cv_id uuid not null references cvs (id) on delete cascade,
  kind text not null check (kind in ('generate', 'revise')),
  payload jsonb not null default '{}',
  status text not null check (status in ('queued', 'running', 'done', 'failed')),
  attempts integer not null default 0,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_queued_idx on jobs (created_at) where status = 'queued';
create index jobs_cv_id_idx on jobs (cv_id, created_at desc);
