-- TrueCost — one row per person, holding one loan.
--
-- The row-level policy is the real access boundary. The client guard in the app
-- decides what to render; this decides what can be read, and anything protected
-- only by the former is protected by nothing.

create table if not exists public.loans (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  -- The loan record as the app stores it. Kept as one document because it is
  -- read and written whole, and never queried by field.
  payload    jsonb       not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.loans enable row level security;

-- Four explicit policies rather than one "for all": a mistake in a broad policy
-- is a data leak, and these are short enough to read in full.
create policy "read own loan"
  on public.loans for select
  using (auth.uid() = user_id);

create policy "insert own loan"
  on public.loans for insert
  with check (auth.uid() = user_id);

create policy "update own loan"
  on public.loans for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "delete own loan"
  on public.loans for delete
  using (auth.uid() = user_id);

-- Deleting the account takes the loan with it, via the cascade above. Nothing
-- is retained after someone leaves.
