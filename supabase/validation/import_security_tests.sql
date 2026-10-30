-- Executar somente em qwcxjaldvehwgfnozaby. As contas/linhas fictícias são desfeitas.
create or replace function pg_temp.test_studio_import()
returns jsonb language plpgsql security invoker as $test$
declare
  uid_a uuid := gen_random_uuid();
  uid_b uuid := gen_random_uuid();
  fixture jsonb := $fixture${
  "format": "studio-em-dia",
  "version": 1,
  "exportedAt": "2026-10-27T10:00:00Z",
  "clients": [
    {
      "sourceId": 101,
      "name": "Cliente fictícia importação",
      "phone": "11999990000",
      "notes": "Observação original",
      "createdAt": "2026-10-27T10:00:00Z"
    }
  ],
  "products": [
    {
      "sourceId": 201,
      "name": "Base fictícia",
      "purchasePriceCents": 8000,
      "totalAmount": 30,
      "unit": "ml",
      "usePerService": 1
    },
    {
      "sourceId": 202,
      "name": "Base fictícia",
      "purchasePriceCents": 8000,
      "totalAmount": 30,
      "unit": "ml",
      "usePerService": 1
    }
  ],
  "appointments": [
    {
      "sourceId": 301,
      "clientId": 101,
      "clientName": "Cliente fictícia importação",
      "service": "Maquiagem social",
      "serviceDate": "2026-10-28",
      "serviceTime": "14:00",
      "status": "scheduled",
      "amountCents": 20000,
      "productIds": [
        201,
        202
      ],
      "productCostCents": 534,
      "extraCostCents": 0,
      "paymentFeeCents": 0
    }
  ],
  "payments": [
    {
      "sourceId": 401,
      "appointmentId": 301,
      "amountCents": 5000,
      "kind": "deposit",
      "paidAt": "2026-10-27",
      "note": "Primeiro pagamento"
    },
    {
      "sourceId": 402,
      "appointmentId": 301,
      "amountCents": 5000,
      "kind": "partial",
      "paidAt": "2026-10-27",
      "note": "Segundo pagamento"
    }
  ],
  "expenses": [
    {
      "sourceId": 501,
      "description": "Gasto fictício",
      "category": "Materiais",
      "expenseDate": "2026-10-27",
      "amountCents": 1000
    }
  ],
  "settings": {
    "monthlyGoalCents": 500000,
    "reservePercent": 10
  }
}
$fixture$::jsonb;
  changed jsonb;
  result jsonb;
  checks jsonb := '[]';
  app_a bigint;
  client_a bigint;
  product_a bigint;
  count_before bigint;
  rejected boolean;
  scenario text;
begin
  begin
    insert into auth.users(id) values(uid_a),(uid_b);
    -- Falha injetada após gravações anteriores; removida pelo rollback da fixture.
    execute $ddl$ create function pg_temp.fail_import_expense() returns trigger language plpgsql as $fail$
      begin
        if new.category='Falha tardia de teste' then
          raise exception 'Falha simulada após gravações' using errcode='23514';
        end if;
        return new;
      end; $fail$ $ddl$;
    create trigger studio_import_test_failure before insert on public.expenses
      for each row execute function pg_temp.fail_import_expense();
    perform set_config('request.jwt.claims',jsonb_build_object('sub',uid_a,'role','authenticated')::text,true);
    perform set_config('role','authenticated',true);

    result := public.import_studio_backup(fixture);
    assert result = '{"added":8,"kept":0}'::jsonb, 'primeira importação';
    assert (select count(*) from public.products)=2, 'itens iguais distintos';
    select id,client_id into app_a,client_a from public.appointments;
    select min(id) into product_a from public.products;
    assert (select cardinality(product_ids) from public.appointments)=2, 'vínculos produtos';
    assert (select sum(amount_cents) from public.payments)=10000, 'pagamentos';
    checks := checks || '"importação completa e vínculos"'::jsonb;

    result := public.import_studio_backup(fixture);
    assert result = '{"added":0,"kept":8}'::jsonb, 'repetição/resposta perdida';
    checks := checks || '"repetição após resposta perdida sem duplicar"'::jsonb;

    update public.clients set name='Cliente editada' where id=client_a;
    update public.products set purchase_price_cents=9000 where id=product_a;
    result := public.import_studio_backup(fixture);
    assert result->>'added'='0', 'reimportação após edição duplicou';
    assert (select name from public.clients where id=client_a)='Cliente editada', 'sobrescreveu cliente';
    assert (select purchase_price_cents from public.products where id=product_a)=9000, 'sobrescreveu produto';
    assert (select product_cost_cents from public.appointments where id=app_a)=534, 'custo histórico mudou';
    checks := checks || '"preserva edições e custos históricos"'::jsonb;

    delete from public.expenses;
    result := public.import_studio_backup(fixture);
    assert result = '{"added":1,"kept":7}'::jsonb, 'restauração de registro excluído';
    checks := checks || '"restaura somente registro ausente"'::jsonb;

    -- Modificar o arquivo cria outra impressão digital; a mesclagem semântica ainda funciona.
    changed := jsonb_set(fixture,'{clients,0,name}','"Cliente editada"');
    changed := jsonb_set(changed,'{products,0,purchasePriceCents}','9000');
    changed := jsonb_set(changed,'{clients,0,notes}','"Outra observação no arquivo"');
    result := public.import_studio_backup(changed);
    assert result->>'added'='0', 'mesclagem com dados existentes';
    assert (select notes from public.clients where id=client_a)='Observação original', 'sobrescreveu notas';
    checks := checks || '"mesclagem preserva dados existentes"'::jsonb;

    changed := jsonb_set(fixture,'{clients,0,name}','"Cliente nova para falha"');
    changed := jsonb_set(changed,'{appointments,0,clientName}','"Cliente nova para falha"');
    changed := jsonb_set(changed,'{products,0,name}','"Produto novo para falha"');
    changed := jsonb_set(changed,'{expenses,0,category}','"Falha tardia de teste"'::jsonb);
    select count(*) into count_before from public.clients;
    rejected := false;
    begin perform public.import_studio_backup(changed);
    exception when check_violation then rejected := true; end;
    assert rejected, 'falha tardia não rejeitada';
    assert (select count(*) from public.clients)=count_before, 'importação parcial de clientes';
    assert not exists(select 1 from public.products where name='Produto novo para falha'), 'importação parcial de produtos';
    checks := checks || '"erro após gravações desfaz toda a importação"'::jsonb;

    insert into public.payments(appointment_id,amount_cents,kind,paid_at,note)
      values(app_a,10000,'final','2026-10-27','Pagamento registrado depois do backup');
    changed := jsonb_set(fixture,'{clients,0,name}','"Cliente editada"');
    changed := jsonb_set(changed,'{products,0,purchasePriceCents}','9000');
    changed := jsonb_set(changed,'{payments}',(changed->'payments') || '{"sourceId":403,"appointmentId":301,"amountCents":5000,"kind":"partial","paidAt":"2026-10-27","note":"Novo pagamento no arquivo"}'::jsonb);
    rejected := false;
    begin perform public.import_studio_backup(changed);
    exception when check_violation then rejected := true; end;
    assert rejected, 'pagamentos excedentes na mesclagem';
    assert (select sum(amount_cents) from public.payments)=20000, 'total alterado por falha';
    checks := checks || '"bloqueia pagamento excedente na mesclagem"'::jsonb;

    foreach scenario in array array['duplicate','orphan','fraction','date','product','status','negative','large'] loop
      changed := fixture;
      case scenario
        when 'duplicate' then changed := jsonb_set(changed,'{clients}',changed->'clients'||changed->'clients');
        when 'orphan' then changed := jsonb_set(changed,'{payments,0,appointmentId}','999');
        when 'fraction' then changed := jsonb_set(changed,'{payments,0,amountCents}','1.5');
        when 'date' then changed := jsonb_set(changed,'{appointments,0,serviceDate}','"2026-02-30"');
        when 'product' then changed := jsonb_set(changed,'{appointments,0,productIds}','[999]');
        when 'status' then changed := jsonb_set(changed,'{appointments,0,status}','"invalid"');
        when 'negative' then changed := jsonb_set(changed,'{products,0,totalAmount}','-1');
        when 'large' then changed := jsonb_set(changed,'{appointments,0,amountCents}','2147483648');
      end case;
      rejected := false;
      begin perform public.import_studio_backup(changed);
      exception when others then rejected := true; end;
      assert rejected, 'arquivo inválido aceito: '||scenario;
      checks := checks || to_jsonb('RPC rejeita '||scenario);
    end loop;

    perform set_config('request.jwt.claims',jsonb_build_object('sub',uid_b,'role','authenticated')::text,true);
    assert (select count(*) from public.clients)=0, 'RLS select outra conta';
    assert (select count(*) from public.studio_import_receipts)=0, 'RLS recibos outra conta';
    update public.clients set notes='tentativa indevida' where id=client_a;
    assert not found, 'RLS update outra conta';
    rejected := false;
    begin insert into public.payments(appointment_id,amount_cents,kind,paid_at) values(app_a,1,'partial','2026-10-27');
    exception when others then rejected := true; end;
    assert rejected, 'vínculo pagamento de outra conta';
    rejected := false;
    begin insert into public.appointments(client_id,client_name,service,service_date,amount_cents,product_ids)
      values(client_a,'X','X','2026-10-27',1000,array[product_a]);
    exception when others then rejected := true; end;
    assert rejected, 'vínculo cliente/produto de outra conta';
    result := public.import_studio_backup(fixture);
    assert result = '{"added":8,"kept":0}'::jsonb, 'importação misturou as contas';
    assert (select id from public.appointments)<>app_a, 'reutilizou atendimento da outra conta';
    checks := checks || '"isolamento entre duas contas e recibos"'::jsonb;

    rejected := false;
    begin update public.clients set user_id=uid_a;
    exception when insufficient_privilege then rejected := true; end;
    assert rejected, 'transferência de propriedade permitida';
    checks := checks || '"bloqueia transferência de propriedade"'::jsonb;

    perform set_config('request.jwt.claims','{}',true);
    rejected := false;
    begin perform public.import_studio_backup(fixture);
    exception when insufficient_privilege then rejected := true; end;
    assert rejected, 'RPC sem usuário';
    perform set_config('role','anon',true);
    rejected := false;
    begin perform public.import_studio_backup(fixture);
    exception when insufficient_privilege then rejected := true; end;
    assert rejected, 'RPC anônimo';
    rejected := false;
    begin perform count(*) from public.clients;
    exception when insufficient_privilege then rejected := true; end;
    assert rejected, 'leitura anônima';
    checks := checks || '"bloqueia RPC e tabelas sem autenticação"'::jsonb;
    perform set_config('role','postgres',true);
    raise exception using errcode='ZX001',message='rollback_fixture';
  exception when sqlstate 'ZX001' then null;
  end;
  assert not exists(select 1 from auth.users where id in (uid_a,uid_b)), 'fixture não desfeita';
  return jsonb_build_object('passed',jsonb_array_length(checks),'checks',checks,'fixture_rolled_back',true);
end;
$test$;
select pg_temp.test_studio_import() as test_results;
