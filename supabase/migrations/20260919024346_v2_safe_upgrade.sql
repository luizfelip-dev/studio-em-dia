-- Studio em Dia V2: atualização aditiva e repetível da estrutura V1.
-- Não remove tabelas, colunas ou registros existentes.

create table if not exists public.clients (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  phone text check (phone is null or length(trim(phone)) between 8 and 30),
  notes text check (notes is null or length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.appointments
  add column if not exists client_id bigint,
  add column if not exists service_time time without time zone,
  add column if not exists status text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'appointments_client_id_fkey'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      add constraint appointments_client_id_fkey
      foreign key (client_id) references public.clients(id) on delete set null;
  end if;
end
$$;

update public.appointments
set status = case
  when service_date < current_date then 'completed'
  else 'scheduled'
end
where status is null;

alter table public.appointments
  alter column status set default 'scheduled',
  alter column status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'appointments_status_check'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      add constraint appointments_status_check
      check (status in ('scheduled', 'confirmed', 'completed', 'cancelled'));
  end if;
end
$$;

create table if not exists public.payments (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  appointment_id bigint not null references public.appointments(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  kind text not null check (kind in ('deposit', 'partial', 'final', 'full')),
  paid_at date not null default current_date,
  note text check (note is null or length(note) <= 300),
  created_at timestamptz not null default now()
);

create index if not exists clients_user_name_idx
  on public.clients (user_id, name);
create index if not exists appointments_user_client_idx
  on public.appointments (user_id, client_id);
create index if not exists appointments_client_id_idx
  on public.appointments (client_id);
create index if not exists appointments_user_schedule_idx
  on public.appointments (user_id, service_date, service_time);
create index if not exists payments_user_appointment_date_idx
  on public.payments (user_id, appointment_id, paid_at desc);
create index if not exists payments_appointment_id_idx
  on public.payments (appointment_id);

with client_candidates as (
  select
    appointments.user_id,
    min(trim(appointments.client_name)) as name,
    lower(trim(appointments.client_name)) as normalized_name
  from public.appointments
  group by appointments.user_id, lower(trim(appointments.client_name))
)
insert into public.clients (user_id, name)
select candidate.user_id, candidate.name
from client_candidates candidate
where not exists (
  select 1
  from public.clients existing_client
  where existing_client.user_id = candidate.user_id
    and lower(trim(existing_client.name)) = candidate.normalized_name
);

update public.appointments appointment
set client_id = client.id
from public.clients client
where appointment.client_id is null
  and client.user_id = appointment.user_id
  and lower(trim(client.name)) = lower(trim(appointment.client_name));

-- Na V1 não existia controle de pagamentos. Para preservar os totais que já
-- apareciam como recebidos, cada atendimento antigo entra como quitado.
insert into public.payments (
  user_id,
  appointment_id,
  amount_cents,
  kind,
  paid_at,
  note
)
select
  appointment.user_id,
  appointment.id,
  appointment.amount_cents,
  'full',
  appointment.service_date,
  'Pagamento preservado da versão anterior'
from public.appointments appointment
where not exists (
  select 1
  from public.payments payment
  where payment.appointment_id = appointment.id
);

alter table public.clients enable row level security;
alter table public.payments enable row level security;

drop policy if exists clients_select_own on public.clients;
drop policy if exists clients_insert_own on public.clients;
drop policy if exists clients_update_own on public.clients;
drop policy if exists clients_delete_own on public.clients;

create policy clients_select_own on public.clients
  for select to authenticated
  using ((select auth.uid()) = user_id);
create policy clients_insert_own on public.clients
  for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy clients_update_own on public.clients
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy clients_delete_own on public.clients
  for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists appointments_insert_own on public.appointments;
drop policy if exists appointments_update_own on public.appointments;

create policy appointments_insert_own on public.appointments
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and (
      client_id is null
      or exists (
        select 1
        from public.clients
        where clients.id = appointments.client_id
          and clients.user_id = (select auth.uid())
      )
    )
  );
create policy appointments_update_own on public.appointments
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (
      client_id is null
      or exists (
        select 1
        from public.clients
        where clients.id = appointments.client_id
          and clients.user_id = (select auth.uid())
      )
    )
  );

drop policy if exists payments_select_own on public.payments;
drop policy if exists payments_insert_own on public.payments;
drop policy if exists payments_update_own on public.payments;
drop policy if exists payments_delete_own on public.payments;

create policy payments_select_own on public.payments
  for select to authenticated
  using ((select auth.uid()) = user_id);
create policy payments_insert_own on public.payments
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.appointments
      where appointments.id = payments.appointment_id
        and appointments.user_id = (select auth.uid())
    )
  );
create policy payments_update_own on public.payments
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.appointments
      where appointments.id = payments.appointment_id
        and appointments.user_id = (select auth.uid())
    )
  );
create policy payments_delete_own on public.payments
  for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.clients, public.payments from anon;
grant select, insert, update, delete on public.clients, public.payments to authenticated;
grant usage, select on sequence public.clients_id_seq to authenticated;
grant usage, select on sequence public.payments_id_seq to authenticated;
