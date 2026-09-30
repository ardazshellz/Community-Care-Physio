create table if not exists public.practice_records (
  key text primary key,
  kind text not null check (kind in ('referral','invoice','intake','card','settings','counter')),
  value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists practice_records_kind_idx on public.practice_records(kind);
alter table public.practice_records enable row level security;
revoke all on public.practice_records from public, anon, authenticated;
grant select, insert, update, delete on public.practice_records to service_role;

-- Atomic invoice counter; accessible only to the server's service role.
create or replace function public.next_invoice_number() returns integer
language sql security invoker set search_path = '' as $$
  insert into public.practice_records(key, kind, value) values ('counter:invoice','counter','{"n":1}')
  on conflict (key) do update
    set value = jsonb_build_object('n', coalesce((public.practice_records.value->>'n')::int,0) + 1), updated_at = now()
  returning (value->>'n')::int;
$$;
revoke all on function public.next_invoice_number() from public, anon, authenticated;
grant execute on function public.next_invoice_number() to service_role;
