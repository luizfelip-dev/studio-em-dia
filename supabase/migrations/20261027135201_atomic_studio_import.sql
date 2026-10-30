-- TESTES primeiro. Não substituir tabelas ou dados existentes.
-- SECURITY INVOKER: todas as consultas/gravações continuam sujeitas ao RLS.
create table public.studio_import_receipts (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  fingerprint text not null check (length(fingerprint) = 64),
  added integer not null check (added >= 0),
  kept integer not null check (kept >= 0),
  record_ids jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, fingerprint)
);
alter table public.studio_import_receipts enable row level security;
create policy import_receipts_select_own on public.studio_import_receipts
  for select to authenticated using ((select auth.uid()) = user_id);
create policy import_receipts_insert_own on public.studio_import_receipts
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy import_receipts_update_own on public.studio_import_receipts
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.studio_import_receipts from public, anon, authenticated;
grant select, insert, update on public.studio_import_receipts to authenticated;

create function public.studio_import_text(value text)
returns text language sql immutable security invoker set search_path = ''
as $$ select lower(regexp_replace(btrim(coalesce(value, '')), '\s+', ' ', 'g')) $$;
revoke all on function public.studio_import_text(text) from public, anon;
grant execute on function public.studio_import_text(text) to authenticated;

create function public.import_studio_backup(backup jsonb)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  fingerprint_value text;
  receipt public.studio_import_receipts%rowtype;
  group_name text;
  field_name text;
  record_value jsonb;
  mapped jsonb;
  client_map jsonb := '{}';
  product_map jsonb := '{}';
  appointment_map jsonb := '{}';
  matched_ids bigint[];
  mapped_products bigint[];
  target_id bigint;
  parent_id bigint;
  source_id bigint;
  columns_list text;
  predicate text;
  record_ids jsonb := '{}';
  group_ids jsonb;
  count_added integer := 0;
  count_kept integer := 0;
  total_count integer := 0;
  amount numeric;
  max_length integer;
begin
  if owner_id is null then
    raise exception 'Entre novamente antes de importar o backup.' using errcode = '42501';
  end if;
  if jsonb_typeof(backup) is distinct from 'object'
     or backup->>'format' is distinct from 'studio-em-dia'
     or backup->'version' is distinct from '1'::jsonb
     or octet_length(backup::text) > 33554432 then
    raise exception 'Arquivo de backup inválido ou acima do limite.' using errcode = '22023';
  end if;
  foreach group_name in array array['clients','products','appointments','payments','expenses'] loop
    if jsonb_typeof(backup->group_name) is distinct from 'array' then
      raise exception 'O backup não contém todas as listas necessárias.' using errcode = '22023';
    end if;
    total_count := total_count + jsonb_array_length(backup->group_name);
  end loop;
  if total_count > 20000 or jsonb_typeof(backup->'settings') is distinct from 'object' then
    raise exception 'Backup acima do limite ou sem configurações.' using errcode = '22023';
  end if;

  -- Todas as importações da mesma conta são serializadas. Outra conta tem sua própria trava.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id::text, 0));
  fingerprint_value := encode(sha256(convert_to((backup - 'exportedAt')::text, 'UTF8')), 'hex');
  select * into receipt from public.studio_import_receipts
    where user_id = owner_id and fingerprint = fingerprint_value;


  -- Validar também no servidor: o RPC pode ser chamado sem o formulário/Excel.
  foreach group_name in array array['clients','products','appointments','payments','expenses','settings'] loop
    for record_value in select value from jsonb_array_elements(
      case when group_name='settings' then jsonb_build_array(backup->'settings') else backup->group_name end
    ) loop
      if jsonb_typeof(record_value) is distinct from 'object' then
        raise exception 'Registro inválido no backup.' using errcode = '22023';
      end if;
      if group_name <> 'settings' then
        if jsonb_typeof(record_value->'sourceId') is distinct from 'number' then
          raise exception 'Identificador inválido no backup.' using errcode = '22023';
        end if;
        amount := (record_value->>'sourceId')::numeric;
        if amount < 1 or amount <> trunc(amount) or amount > 9007199254740991 then
          raise exception 'Identificador inválido no backup.' using errcode = '22023';
        end if;
      end if;
      foreach field_name in array (case group_name
        when 'clients' then array['name','phone','notes','createdAt']
        when 'products' then array['name','unit']
        when 'appointments' then array['clientName','service','serviceDate','serviceTime','status']
        when 'payments' then array['kind','paidAt','note']
        when 'expenses' then array['description','category','expenseDate']
        else array[]::text[] end) loop
        if jsonb_typeof(record_value->field_name) is distinct from 'string' then
          raise exception 'Texto obrigatório inválido no backup.' using errcode = '22023';
        end if;
        max_length := case field_name
          when 'name' then 120 when 'phone' then 30 when 'notes' then 1000 when 'createdAt' then 40
          when 'unit' then 3 when 'clientName' then 120 when 'service' then 240 when 'serviceTime' then 5
          when 'description' then 160 when 'category' then 80 when 'note' then 300
          when 'serviceDate' then 10 when 'expenseDate' then 10 when 'paidAt' then 10 else 20 end;
        if length(record_value->>field_name) > max_length
          or (field_name not in ('phone','notes','note','serviceTime') and btrim(record_value->>field_name)='') then
          raise exception 'Texto vazio ou acima do limite no backup.' using errcode = '22023';
        end if;
      end loop;
      if group_name='clients' then
        if record_value->>'phone' <> '' and length(btrim(record_value->>'phone')) < 8 then
          raise exception 'Telefone inválido no backup.' using errcode = '22023';
        end if;
        if not isfinite((record_value->>'createdAt')::timestamptz) then
          raise exception 'Data de cadastro inválida.' using errcode = '22023';
        end if;
      elsif group_name='products' and record_value->>'unit' not in ('ml','g','un.') then
        raise exception 'Unidade inválida no backup.' using errcode = '22023';
      elsif group_name='appointments' and record_value->>'status' not in ('scheduled','confirmed','completed','cancelled') then
        raise exception 'Status inválido no backup.' using errcode = '22023';
      elsif group_name='payments' and record_value->>'kind' not in ('deposit','partial','final','full') then
        raise exception 'Tipo de pagamento inválido no backup.' using errcode = '22023';
      end if;
      foreach field_name in array (case group_name
        when 'products' then array['purchasePriceCents']
        when 'appointments' then array['amountCents','productCostCents','extraCostCents','paymentFeeCents']
        when 'payments' then array['amountCents']
        when 'expenses' then array['amountCents']
        when 'settings' then array['monthlyGoalCents']
        else array[]::text[] end) loop
        if jsonb_typeof(record_value->field_name) is distinct from 'number' then
          raise exception 'Valor monetário inválido no backup.' using errcode = '22023';
        end if;
        amount := (record_value->>field_name)::numeric;
        if amount <> trunc(amount) or amount > 2147483647 or amount < (case
          when field_name in ('productCostCents','extraCostCents','paymentFeeCents') then 0 else 1 end) then
          raise exception 'Valor monetário fora do limite.' using errcode = '22023';
        end if;
      end loop;
      if group_name='products' then
        foreach field_name in array array['totalAmount','usePerService'] loop
          if jsonb_typeof(record_value->field_name) is distinct from 'number'
            or (record_value->>field_name)::numeric < 0.001
            or (record_value->>field_name)::numeric > 999999999.999
            or (record_value->>field_name)::numeric <> trunc((record_value->>field_name)::numeric,3) then
            raise exception 'Quantidade de produto fora do limite.' using errcode = '22023';
          end if;
        end loop;
      elsif group_name='settings' then
        if jsonb_typeof(record_value->'reservePercent') is distinct from 'number'
          or (record_value->>'reservePercent')::numeric not between 0 and 100
          or (record_value->>'reservePercent')::numeric <> trunc((record_value->>'reservePercent')::numeric,2) then
          raise exception 'Percentual de reserva inválido.' using errcode = '22023';
        end if;
      elsif group_name='appointments' then
        if not record_value ? 'clientId' or (record_value->'clientId' <> 'null'::jsonb and not exists (
          select 1 from jsonb_array_elements(backup->'clients') c where c->'sourceId'=record_value->'clientId'
        )) then
          raise exception 'Atendimento sem cliente correspondente no backup.' using errcode = '22023';
        end if;
        if record_value->>'serviceTime' <> '' and record_value->>'serviceTime' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
          raise exception 'Horário inválido no backup.' using errcode = '22023';
        end if;
        if jsonb_typeof(record_value->'productIds') is distinct from 'array' then
          raise exception 'Lista de produtos inválida.' using errcode = '22023';
        end if;
        if jsonb_array_length(record_value->'productIds') > 500
          or jsonb_array_length(record_value->'productIds') <> (select count(distinct value) from jsonb_array_elements(record_value->'productIds'))
          or exists (select 1 from jsonb_array_elements(record_value->'productIds') pid
            where not exists (select 1 from jsonb_array_elements(backup->'products') p where p->'sourceId'=pid)) then
          raise exception 'Produto repetido ou desconhecido no atendimento.' using errcode = '22023';
        end if;
      elsif group_name='payments' then
        if not exists (select 1 from jsonb_array_elements(backup->'appointments') a where a->'sourceId'=record_value->'appointmentId') then
          raise exception 'Pagamento sem atendimento correspondente no backup.' using errcode = '22023';
        end if;
      end if;
      -- O cast rejeita datas impossíveis; a expressão impede formatos ambíguos.
      foreach field_name in array (case group_name
        when 'appointments' then array['serviceDate'] when 'payments' then array['paidAt']
        when 'expenses' then array['expenseDate'] else array[]::text[] end) loop
        if record_value->>field_name !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
          raise exception 'Data inválida no backup.' using errcode = '22023';
        end if;
        perform (record_value->>field_name)::date;
      end loop;
    end loop;
    if group_name <> 'settings' and jsonb_array_length(backup->group_name) <> (
      select count(distinct value->'sourceId') from jsonb_array_elements(backup->group_name)
    ) then
      raise exception 'O backup contém identificadores repetidos.' using errcode = '22023';
    end if;
  end loop;

  if exists (select 1 from jsonb_array_elements(backup->'appointments') a
    where (a->>'amountCents')::numeric < (
      select coalesce(sum((p->>'amountCents')::numeric),0) from jsonb_array_elements(backup->'payments') p
      where p->'appointmentId'=a->'sourceId')) then
    raise exception 'O backup contém pagamentos acima do valor do atendimento.' using errcode = '23514';
  end if;

  foreach group_name in array array['clients','products','appointments','expenses','payments'] loop
    matched_ids := array[]::bigint[];
    group_ids := '{}';
    for record_value in select value from jsonb_array_elements(backup->group_name) loop
      source_id := (record_value->>'sourceId')::bigint;
      case group_name
      when 'clients' then
        mapped := jsonb_build_object('name',record_value->>'name','phone',nullif(record_value->>'phone',''),
          'notes',nullif(record_value->>'notes',''),'created_at',record_value->>'createdAt');
        columns_list := 'name,phone,notes,created_at';
        predicate := $predicate$public.studio_import_text(t.name)=public.studio_import_text($2->>'name') and regexp_replace(coalesce(t.phone,''),'\D','','g')=regexp_replace(coalesce($2->>'phone',''),'\D','','g')$predicate$;
      when 'products' then
        mapped := jsonb_build_object('name',record_value->>'name','unit',record_value->>'unit',
          'purchase_price_cents',record_value->'purchasePriceCents','total_amount',record_value->'totalAmount','use_per_service',record_value->'usePerService');
        columns_list := 'name,unit,purchase_price_cents,total_amount,use_per_service';
        predicate := 'public.studio_import_text(t.name)=public.studio_import_text($2->>''name'') and t.unit=$2->>''unit'' and t.purchase_price_cents=($2->>''purchase_price_cents'')::integer and t.total_amount=($2->>''total_amount'')::numeric and t.use_per_service=($2->>''use_per_service'')::numeric';
      when 'appointments' then
        select coalesce(array_agg((product_map->>pid)::bigint),array[]::bigint[]) into mapped_products
          from jsonb_array_elements_text(record_value->'productIds') pid;
        mapped := jsonb_build_object('client_id',client_map->>(record_value->>'clientId'),'client_name',record_value->>'clientName',
          'service',record_value->>'service','service_date',record_value->>'serviceDate',
          'service_time',nullif(record_value->>'serviceTime',''),'status',record_value->>'status',
          'amount_cents',record_value->'amountCents','product_ids',to_jsonb(mapped_products),
          'product_cost_cents',record_value->'productCostCents','extra_cost_cents',record_value->'extraCostCents','payment_fee_cents',record_value->'paymentFeeCents');
        columns_list := 'client_id,client_name,service,service_date,service_time,status,amount_cents,product_ids,product_cost_cents,extra_cost_cents,payment_fee_cents';
        predicate := 't.client_id is not distinct from ($2->>''client_id'')::bigint and public.studio_import_text(t.client_name)=public.studio_import_text($2->>''client_name'') and public.studio_import_text(t.service)=public.studio_import_text($2->>''service'') and t.service_date=($2->>''service_date'')::date and t.service_time is not distinct from ($2->>''service_time'')::time and t.amount_cents=($2->>''amount_cents'')::integer';
      when 'expenses' then
        mapped := jsonb_build_object('description',record_value->>'description','category',record_value->>'category',
          'expense_date',record_value->>'expenseDate','amount_cents',record_value->'amountCents');
        columns_list := 'description,category,expense_date,amount_cents';
        predicate := 'public.studio_import_text(t.description)=public.studio_import_text($2->>''description'') and public.studio_import_text(t.category)=public.studio_import_text($2->>''category'') and t.expense_date=($2->>''expense_date'')::date and t.amount_cents=($2->>''amount_cents'')::integer';
      when 'payments' then
        parent_id := (appointment_map->>(record_value->>'appointmentId'))::bigint;
        mapped := jsonb_build_object('appointment_id',parent_id,'amount_cents',record_value->'amountCents',
          'kind',record_value->>'kind','paid_at',record_value->>'paidAt','note',nullif(record_value->>'note',''));
        columns_list := 'appointment_id,amount_cents,kind,paid_at,note';
        predicate := 't.appointment_id=($2->>''appointment_id'')::bigint and t.amount_cents=($2->>''amount_cents'')::integer and t.kind=$2->>''kind'' and t.paid_at=($2->>''paid_at'')::date and public.studio_import_text(t.note)=public.studio_import_text($2->>''note'')';
      end case;

      -- Nomes de tabelas/colunas e predicados vêm apenas dos CASE fixos acima.
      -- O conteúdo do arquivo é enviado como parâmetro, nunca como SQL.
      -- Repetir o mesmo arquivo preserva inclusive registros editados desde a importação.
      -- Se um registro foi excluído, somente ele será restaurado pelo fluxo normal.
      execute format('select id from public.%I where user_id=$1 and id=$2 and not(id=any($3)) for update',group_name)
        into target_id using owner_id,(receipt.record_ids->group_name->>source_id::text)::bigint,matched_ids;
      if target_id is null then
        execute format('select t.id from public.%I t where t.user_id=$1 and not(t.id=any($3)) and (%s) order by (t.id=$4) desc,t.id limit 1 for update',group_name,predicate)
          into target_id using owner_id,mapped,matched_ids,source_id;
      end if;
      if target_id is null then
        execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I,$1) returning id',group_name,columns_list)
          into target_id using mapped;
        count_added := count_added + 1;
      else
        count_kept := count_kept + 1;
      end if;
      matched_ids := array_append(matched_ids,target_id);
      group_ids := group_ids || jsonb_build_object(source_id::text,target_id);
      if group_name='clients' then client_map := client_map || jsonb_build_object(source_id::text,target_id);
      elsif group_name='products' then product_map := product_map || jsonb_build_object(source_id::text,target_id);
      elsif group_name='appointments' then appointment_map := appointment_map || jsonb_build_object(source_id::text,target_id);
      end if;
    end loop;
    record_ids := record_ids || jsonb_build_object(group_name,group_ids);
  end loop;
  insert into public.studio_settings(user_id,monthly_goal_cents,reserve_percent)
    values(owner_id,(backup->'settings'->>'monthlyGoalCents')::integer,(backup->'settings'->>'reservePercent')::numeric)
    on conflict(user_id) do nothing;
  if found then count_added := count_added+1; else count_kept := count_kept+1; end if;
  insert into public.studio_import_receipts(user_id,fingerprint,added,kept,record_ids)
    values(owner_id,fingerprint_value,count_added,count_kept,record_ids)
    on conflict(user_id,fingerprint) do update set added=excluded.added,kept=excluded.kept,record_ids=excluded.record_ids;
  return jsonb_build_object('added',count_added,'kept',count_kept);
end;
$$;
revoke all on function public.import_studio_backup(jsonb) from public, anon;
grant execute on function public.import_studio_backup(jsonb) to authenticated;
