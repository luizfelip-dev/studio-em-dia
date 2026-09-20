create table public.products (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  purchase_price_cents integer not null check (purchase_price_cents > 0),
  total_amount numeric(12,3) not null check (total_amount > 0),
  unit text not null check (unit in ('ml', 'g', 'un.')),
  use_per_service numeric(12,3) not null check (use_per_service > 0),
  created_at timestamptz not null default now()
);

create table public.appointments (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_name text not null check (length(trim(client_name)) between 1 and 120),
  service text not null check (length(trim(service)) between 1 and 240),
  service_date date not null,
  amount_cents integer not null check (amount_cents > 0),
  product_cost_cents integer not null default 0 check (product_cost_cents >= 0),
  extra_cost_cents integer not null default 0 check (extra_cost_cents >= 0),
  payment_fee_cents integer not null default 0 check (payment_fee_cents >= 0),
  created_at timestamptz not null default now()
);

create table public.expenses (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  description text not null check (length(trim(description)) between 1 and 160),
  category text not null check (length(trim(category)) between 1 and 80),
  expense_date date not null,
  amount_cents integer not null check (amount_cents > 0),
  created_at timestamptz not null default now()
);

create table public.studio_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  monthly_goal_cents integer not null default 500000 check (monthly_goal_cents > 0),
  reserve_percent numeric(5,2) not null default 10 check (reserve_percent between 0 and 100),
  updated_at timestamptz not null default now()
);

create index products_user_created_idx on public.products (user_id, created_at desc);
create index appointments_user_date_idx on public.appointments (user_id, service_date desc);
create index expenses_user_date_idx on public.expenses (user_id, expense_date desc);

alter table public.products enable row level security;
alter table public.appointments enable row level security;
alter table public.expenses enable row level security;
alter table public.studio_settings enable row level security;

create policy products_select_own on public.products for select to authenticated using ((select auth.uid()) = user_id);
create policy products_insert_own on public.products for insert to authenticated with check ((select auth.uid()) = user_id);
create policy products_update_own on public.products for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy products_delete_own on public.products for delete to authenticated using ((select auth.uid()) = user_id);

create policy appointments_select_own on public.appointments for select to authenticated using ((select auth.uid()) = user_id);
create policy appointments_insert_own on public.appointments for insert to authenticated with check ((select auth.uid()) = user_id);
create policy appointments_update_own on public.appointments for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy appointments_delete_own on public.appointments for delete to authenticated using ((select auth.uid()) = user_id);

create policy expenses_select_own on public.expenses for select to authenticated using ((select auth.uid()) = user_id);
create policy expenses_insert_own on public.expenses for insert to authenticated with check ((select auth.uid()) = user_id);
create policy expenses_update_own on public.expenses for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy expenses_delete_own on public.expenses for delete to authenticated using ((select auth.uid()) = user_id);

create policy settings_select_own on public.studio_settings for select to authenticated using ((select auth.uid()) = user_id);
create policy settings_insert_own on public.studio_settings for insert to authenticated with check ((select auth.uid()) = user_id);
create policy settings_update_own on public.studio_settings for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy settings_delete_own on public.studio_settings for delete to authenticated using ((select auth.uid()) = user_id);

revoke all on public.products, public.appointments, public.expenses, public.studio_settings from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.products, public.appointments, public.expenses, public.studio_settings to authenticated;
grant usage, select on all sequences in schema public to authenticated;
