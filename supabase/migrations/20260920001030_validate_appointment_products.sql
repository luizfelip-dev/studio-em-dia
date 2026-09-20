create or replace function public.validate_appointment_product_ids()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if cardinality(new.product_ids) <> (
    select count(distinct product_id)
    from unnest(new.product_ids) as selected(product_id)
  ) then
    raise exception 'A lista de produtos contém itens repetidos.';
  end if;

  if exists (
    select 1
    from unnest(new.product_ids) as selected(product_id)
    left join public.products as product
      on product.id = selected.product_id
     and product.user_id = new.user_id
    where product.id is null
  ) then
    raise exception 'Um dos produtos não pertence a esta conta ou não existe.';
  end if;

  return new;
end;
$$;

drop trigger if exists appointments_validate_product_ids on public.appointments;
create trigger appointments_validate_product_ids
before insert or update of product_ids, user_id on public.appointments
for each row execute function public.validate_appointment_product_ids();

create or replace function public.remove_deleted_product_from_appointments()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.appointments
  set product_ids = array_remove(product_ids, old.id)
  where user_id = old.user_id
    and old.id = any(product_ids);

  return old;
end;
$$;

drop trigger if exists products_remove_appointment_references on public.products;
create trigger products_remove_appointment_references
before delete on public.products
for each row execute function public.remove_deleted_product_from_appointments();
