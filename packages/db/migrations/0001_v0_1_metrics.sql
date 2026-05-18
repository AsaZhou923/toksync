create table if not exists users (
  id uuid primary key,
  email text,
  github_id text unique,
  username varchar(39) not null unique,
  username_lower varchar(39) not null unique,
  display_name text,
  avatar_url text,
  public_profile_enabled boolean not null default false,
  show_cost boolean not null default false,
  show_source_breakdown boolean not null default false,
  show_model_breakdown boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists devices (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  device_fingerprint_hash text not null,
  name text not null,
  platform text not null,
  agent_version text not null,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  data_cleared_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, device_fingerprint_hash)
);

create table if not exists device_tokens (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  device_id uuid not null references devices(id) on delete cascade,
  token_hash text not null unique,
  scopes text[] not null,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists device_codes (
  id uuid primary key,
  device_code_hash text not null unique,
  user_code varchar(12) not null unique,
  device_name text not null,
  platform text not null,
  agent_version text not null,
  device_fingerprint_hash text not null,
  authorized_user_id uuid references users(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists device_codes_cleanup_idx on device_codes(expires_at, consumed_at);

create table if not exists sync_runs (
  id uuid primary key,
  client_run_id text not null,
  user_id uuid not null references users(id) on delete cascade,
  device_id uuid not null references devices(id) on delete cascade,
  mode text not null,
  status text not null,
  source_summary jsonb not null,
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  skipped_count integer not null default 0,
  error_count integer not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique(user_id, device_id, client_run_id)
);

create table if not exists usage_events (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  device_id uuid not null references devices(id) on delete cascade,
  sync_run_id uuid not null references sync_runs(id) on delete cascade,
  source text not null,
  source_session_id text not null,
  source_message_id text,
  dedup_key text not null,
  workspace_key_hash text,
  workspace_label text,
  agent text,
  model_id text not null,
  provider_id text,
  timestamp_ms bigint not null,
  local_date date not null,
  input_tokens bigint not null,
  output_tokens bigint not null,
  cache_read_tokens bigint not null,
  cache_write_tokens bigint not null,
  reasoning_tokens bigint not null,
  cost_usd numeric(14, 6),
  message_count integer not null,
  is_turn_start boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, source, dedup_key)
);

create index if not exists usage_events_user_date_idx on usage_events(user_id, local_date);
create index if not exists usage_events_user_device_date_idx on usage_events(user_id, device_id, local_date);
create index if not exists usage_events_user_source_date_idx on usage_events(user_id, source, local_date);
create index if not exists usage_events_user_model_idx on usage_events(user_id, model_id);
create index if not exists usage_events_user_workspace_date_idx on usage_events(user_id, workspace_key_hash, local_date);

create table if not exists usage_daily (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  device_id uuid,
  source text,
  workspace_key_hash text,
  workspace_label text,
  model_id text,
  provider_id text,
  date date not null,
  input_tokens bigint not null,
  output_tokens bigint not null,
  cache_read_tokens bigint not null,
  cache_write_tokens bigint not null,
  reasoning_tokens bigint not null,
  cost_usd numeric(14, 6) not null,
  message_count integer not null,
  turn_count integer not null,
  event_count integer not null,
  updated_at timestamptz not null default now()
);

create unique index if not exists usage_daily_unique_rollup_idx on usage_daily(
  user_id,
  date,
  coalesce(device_id::text, ''),
  coalesce(source, ''),
  coalesce(workspace_key_hash, ''),
  coalesce(model_id, ''),
  coalesce(provider_id, '')
);

create table if not exists profile_stats (
  user_id uuid primary key references users(id) on delete cascade,
  total_tokens bigint not null,
  total_cost_usd numeric(14, 6) not null,
  active_days integer not null,
  top_sources jsonb not null,
  top_models jsonb not null,
  date_start date,
  date_end date,
  last_sync_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public_profile_stats (
  user_id uuid primary key references users(id) on delete cascade,
  username_lower text not null unique,
  display_name text,
  avatar_url text,
  total_tokens bigint not null,
  total_cost_usd numeric(14, 6) not null,
  active_days integer not null,
  top_sources jsonb not null,
  top_models jsonb not null,
  date_start date,
  date_end date,
  last_sync_at timestamptz,
  show_cost boolean not null default false,
  show_source_breakdown boolean not null default false,
  show_model_breakdown boolean not null default false,
  daily_public jsonb,
  leaderboard_opt_in boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists cost_guardrail_rules (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  scope text not null,
  source text,
  model_id text,
  device_id uuid references devices(id) on delete cascade,
  period text not null,
  limit_usd numeric(14, 6) not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cost_guardrail_rules_user_idx on cost_guardrail_rules(user_id);
create index if not exists cost_guardrail_rules_user_scope_idx on cost_guardrail_rules(user_id, scope);

create table if not exists cost_anomalies (
  id text primary key,
  user_id uuid not null references users(id) on delete cascade,
  rule_id uuid references cost_guardrail_rules(id) on delete set null,
  type text not null,
  severity text not null,
  source text,
  model_id text,
  device_id uuid references devices(id) on delete set null,
  period_start date,
  period_end date,
  delta_usd numeric(14, 6),
  explanation text not null,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create index if not exists cost_anomalies_user_idx on cost_anomalies(user_id);
create index if not exists cost_anomalies_user_type_idx on cost_anomalies(user_id, type);
