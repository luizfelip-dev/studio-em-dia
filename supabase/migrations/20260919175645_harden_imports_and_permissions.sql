-- Impede que pagamentos, inclusive durante importações, ultrapassem o valor
-- do atendimento. As travas evitam que duas gravações simultâneas passem
-- pela validação ao mesmo tempo.

create or replace function public.validate_payment_total()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  appointment_amount integer;
  existing_total bigint;
begin
  if tg_op = 'UPDATE' and (
    new.appointment_id is distinct from old.appointment_id
    or new.user_id is distinct from old.user_id
  ) then
    raise exception 'Não é permitido mover um pagamento para outro atendimento.'
      using errcode = '23514';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(new.appointment_id);

  select appointment.amount_cents
    into appointment_amount
  from public.appointments appointment
  where appointment.id = new.appointment_id
    and appointment.user_id = new.user_id
  for update;

  if appointment_amount is null then
    raise exception 'Atendimento inválido para este pagamento.'
      using errcode = '23503';
  end if;

  select coalesce(sum(payment.amount_cents), 0)
    into existing_total
  from public.payments payment
  where payment.appointment_id = new.appointment_id
    and (tg_op = 'INSERT' or payment.id <> old.id);

  if existing_total + new.amount_cents > appointment_amount then
    raise exception 'O valor recebido não pode ultrapassar o valor do atendimento.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create or replace function public.validate_appointment_amount()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  received_total bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(new.id);

  select coalesce(sum(payment.amount_cents), 0)
    into received_total
  from public.payments payment
  where payment.appointment_id = new.id;

  if new.amount_cents < received_total then
    raise exception 'O valor do atendimento não pode ser menor que o total já recebido.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists payments_validate_total on public.payments;
create trigger payments_validate_total
  before insert or update of amount_cents, appointment_id, user_id
  on public.payments
  for each row execute function public.validate_payment_total();

drop trigger if exists appointments_validate_amount on public.appointments;
create trigger appointments_validate_amount
  before update of amount_cents
  on public.appointments
  for each row execute function public.validate_appointment_amount();

revoke all on function public.validate_payment_total() from public, anon, authenticated;
revoke all on function public.validate_appointment_amount() from public, anon, authenticated;

-- O site precisa apenas de leitura e gravação das linhas protegidas por RLS.
-- Criação de gatilhos, truncamento e referências ficam reservados ao banco.
revoke truncate, references, trigger
  on public.products, public.appointments, public.expenses,
     public.studio_settings, public.clients, public.payments
  from authenticated;

revoke select
  on sequence public.products_id_seq, public.appointments_id_seq,
     public.expenses_id_seq, public.clients_id_seq, public.payments_id_seq
  from authenticated;

alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from authenticated;

alter default privileges for role postgres in schema public
  revoke select on sequences from authenticated;
