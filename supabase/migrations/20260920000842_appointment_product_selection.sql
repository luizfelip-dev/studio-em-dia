alter table public.appointments
  add column if not exists product_ids bigint[] not null default '{}'::bigint[];

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'appointments_product_ids_limit'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      add constraint appointments_product_ids_limit
      check (cardinality(product_ids) <= 500);
  end if;
end
$$;

comment on column public.appointments.product_ids is
  'Produtos selecionados no atendimento; product_cost_cents permanece como snapshot histórico do custo.';
