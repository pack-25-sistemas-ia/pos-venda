-- Pós-Venda e Reativação — OPERAÇÕES (parte 3): compras, importação, campanhas, permissões, supressão, LGPD.
-- Toda mudança de compras, estados de campanha e preferências passa por estas funções (papel e MFA verificados dentro).

begin;

create function private.pv_assert_writer(cust uuid) returns public.customers
language plpgsql stable security definer set search_path = '' as $$
declare c public.customers%rowtype;
begin
  select * into c from public.customers where id = cust;
  if not found then raise exception 'cliente não encontrado' using errcode = 'P0002'; end if;
  if private.pv_role(c.organization_id) is null or private.pv_role(c.organization_id) = 'viewer' or not private.pv_can_write(c.organization_id, c.assigned_to) or not private.mfa_ok() then
    raise exception 'sem permissão' using errcode = '42501';
  end if;
  return c;
end $$;
revoke all on function private.pv_assert_writer(uuid) from public;

-- Procura cliente por identificador externo, documento ou e-mail (nessa ordem).
create function private.pv_find_customer(org uuid, p_ext text, p_doc text, p_email text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare id uuid;
begin
  if nullif(btrim(coalesce(p_ext, '')), '') is not null then
    select c.id into id from public.customers c where c.organization_id = org and c.archived_at is null and c.external_customer_id = btrim(p_ext); if id is not null then return id; end if;
  end if;
  if private.pv_norm_doc(p_doc) is not null then
    select c.id into id from public.customers c where c.organization_id = org and c.archived_at is null and c.document_number = private.pv_norm_doc(p_doc); if id is not null then return id; end if;
  end if;
  if private.pv_norm_email(p_email) is not null then
    select c.id into id from public.customers c where c.organization_id = org and c.archived_at is null and c.email = private.pv_norm_email(p_email); if id is not null then return id; end if;
  end if;
  return null;
end $$;
revoke all on function private.pv_find_customer(uuid, text, text, text) from public;

-- ======================================================================= compras
-- Desfaz o que dependia de uma compra que deixou de ser válida (cancelada/estornada): oportunidade volta a aberta, evento e resultado saem.
create function private.pv_unwind_purchase(p_purchase uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.reactivation_opportunities set status = 'open', resolved_at = null, reactivated_purchase_id = null where reactivated_purchase_id = p_purchase;
  delete from public.customer_lifecycle_events where event_type = 'reactivated' and (metadata ->> 'purchase_id') = p_purchase::text;
  delete from public.campaign_outcomes where related_purchase_id = p_purchase;
end $$;
revoke all on function private.pv_unwind_purchase(uuid) from public;

create function public.pv_purchase_create(p_customer uuid, p_external text, p_at timestamptz, p_total_cents bigint, p_items jsonb default '[]', p_source text default null, p_notes text default null, p_allow_duplicate boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.customers%rowtype; pid uuid; key text; it jsonb; had boolean; ext text := nullif(btrim(coalesce(p_external, '')), '');
begin
  c := private.pv_assert_writer(p_customer);
  if p_at is null or p_at > now() + interval '1 day' or p_at < timestamptz '2000-01-01' then raise exception 'data da compra inválida' using errcode = '22023'; end if;
  if p_total_cents is null or p_total_cents < 0 or p_total_cents > 100000000000 then raise exception 'valor inválido' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 100 then raise exception 'itens inválidos' using errcode = '22023'; end if;
  if ext is not null then
    if exists (select 1 from public.purchases where organization_id = c.organization_id and external_order_id = ext) then return jsonb_build_object('ok', false, 'error', 'duplicate_external'); end if;
  elsif not coalesce(p_allow_duplicate, false) then
    key := md5(p_customer::text || '|' || extract(epoch from p_at)::bigint || '|' || p_total_cents);
    if exists (select 1 from public.purchases where organization_id = c.organization_id and dedup_key = key) then return jsonb_build_object('ok', false, 'error', 'possible_duplicate'); end if;
  end if;
  select exists (select 1 from public.purchases where customer_id = p_customer and is_valid) into had;
  insert into public.purchases (organization_id, customer_id, external_order_id, dedup_key, purchased_at, total_cents, source, notes)
  values (c.organization_id, p_customer, ext, key, p_at, p_total_cents, left(p_source, 80), left(p_notes, 1000)) returning id into pid;
  for it in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    insert into public.purchase_items (organization_id, purchase_id, product_name, product_sku, category, quantity, unit_price_cents, total_cents)
    values (c.organization_id, pid, left(btrim(it ->> 'product_name'), 200), nullif(left(btrim(it ->> 'product_sku'), 80), ''), nullif(left(btrim(it ->> 'category'), 80), ''),
            coalesce((it ->> 'quantity')::numeric, 1), coalesce((it ->> 'unit_price_cents')::bigint, 0), coalesce((it ->> 'total_cents')::bigint, 0));
  end loop;
  insert into public.customer_lifecycle_events (organization_id, customer_id, event_type, event_key, metadata, occurred_at)
  values (c.organization_id, p_customer, case when had then 'purchase' else 'first_purchase' end, 'purchase:' || pid, jsonb_build_object('purchase_id', pid, 'total_cents', p_total_cents), p_at);
  perform private.pv_detect_reactivations(c.organization_id);
  return jsonb_build_object('ok', true, 'id', pid);
end $$;

create function public.pv_purchase_cancel(p_purchase uuid) returns void language plpgsql security definer set search_path = '' as $$
declare p public.purchases%rowtype;
begin
  select * into p from public.purchases where id = p_purchase for update;
  if not found then raise exception 'compra não encontrada' using errcode = 'P0002'; end if;
  perform private.pv_assert_manager(p.organization_id);
  if p.status = 'cancelled' then return; end if;
  update public.purchases set status = 'cancelled' where id = p_purchase;
  perform private.pv_unwind_purchase(p_purchase);
end $$;

-- Estorno (parcial ou total) somado ao que já foi estornado; nunca passa do valor da compra.
create function public.pv_purchase_refund(p_purchase uuid, p_cents bigint) returns void language plpgsql security definer set search_path = '' as $$
declare p public.purchases%rowtype;
begin
  select * into p from public.purchases where id = p_purchase for update;
  if not found then raise exception 'compra não encontrada' using errcode = 'P0002'; end if;
  perform private.pv_assert_manager(p.organization_id);
  if p.status = 'cancelled' then raise exception 'compra cancelada não pode ser estornada' using errcode = '23514'; end if;
  if p_cents is null or p_cents <= 0 or p.refunded_cents + p_cents > p.total_cents then raise exception 'valor de estorno inválido' using errcode = '23514'; end if;
  update public.purchases set refunded_cents = refunded_cents + p_cents where id = p_purchase;
  if p.refunded_cents + p_cents = p.total_cents then perform private.pv_unwind_purchase(p_purchase); end if;
end $$;

-- ======================================================================= importação CSV (mesma validação na prévia e na gravação)
create function private.pv_parse_date(t text, tz text) returns timestamptz language plpgsql stable set search_path = '' as $$
begin
  if t ~ '^\d{4}-\d{2}-\d{2}$' then
    if to_char(t::date, 'YYYY-MM-DD') <> t then return null; end if;
    return ((t::date + time '12:00') at time zone tz);
  end if;
  if t ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}' then return t::timestamptz; end if;
  return null;
exception when others then return null;
end $$;
revoke all on function private.pv_parse_date(text, text) from public;

create function public.pv_import_customers(p_org uuid, p_file_name text, p_hash text, p_rows jsonb, p_apply boolean, p_mapping jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb; i int := 0; ok int := 0; dups int := 0; bad int := 0; errs jsonb := '[]'::jsonb; job uuid; v_email text; v_phone text; v_doc text; v_ext text; v_name text; v_type text;
  seen_e text[] := '{}'; seen_d text[] := '{}'; seen_x text[] := '{}'; msg text;
begin
  perform private.pv_assert_manager(p_org);
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then raise exception 'envie até 2.000 linhas' using errcode = '22023'; end if;
  begin
    if p_apply then insert into public.import_jobs (organization_id, kind, file_name, file_hash, mapping_json, total_rows) values (p_org, 'customers', left(coalesce(p_file_name, 'arquivo.csv'), 200), nullif(p_hash, ''), coalesce(p_mapping, '{}'), jsonb_array_length(p_rows)) returning id into job; end if;
    for r in select value from jsonb_array_elements(p_rows) loop
      i := i + 1; msg := null;
      v_email := private.pv_norm_email(r ->> 'email'); v_phone := private.pv_norm_phone(r ->> 'phone'); v_doc := private.pv_norm_doc(r ->> 'document'); v_ext := nullif(left(btrim(coalesce(r ->> 'external_id', '')), 80), '');
      v_name := nullif(left(btrim(coalesce(r ->> 'name', r ->> 'company_name', '')), 160), '');
      v_type := case when lower(coalesce(r ->> 'type', '')) ~ '^(empresa|company|pj|juridica|jurídica)' or length(coalesce(v_doc, '')) = 14 then 'company' else 'person' end;
      if v_name is null then msg := 'Informe o nome.';
      elsif v_email is not null and (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 254) then msg := 'E-mail inválido.';
      elsif nullif(btrim(coalesce(r ->> 'phone', '')), '') is not null and v_phone is null then msg := 'Telefone inválido (use DDD).';
      elsif v_doc is not null and char_length(v_doc) not in (11, 14) then msg := 'CPF/CNPJ deve ter 11 ou 14 dígitos.';
      end if;
      if msg is not null then
        bad := bad + 1;
        if p_apply then insert into public.import_row_errors (organization_id, import_job_id, row_number, error_code, error_message) values (p_org, job, i + 1, 'invalid', msg); end if;
        if jsonb_array_length(errs) < 50 then errs := errs || to_jsonb(format('Linha %s: %s', i + 1, msg)); end if;
        continue;
      end if;
      if private.pv_find_customer(p_org, v_ext, v_doc, v_email) is not null or (v_email is not null and v_email = any (seen_e)) or (v_doc is not null and v_doc = any (seen_d)) or (v_ext is not null and v_ext = any (seen_x)) then
        dups := dups + 1;
        if p_apply then insert into public.import_row_errors (organization_id, import_job_id, row_number, error_code, error_message) values (p_org, job, i + 1, 'duplicate', 'Cliente já cadastrado.'); end if;
        if jsonb_array_length(errs) < 50 then errs := errs || to_jsonb(format('Linha %s: cliente já cadastrado.', i + 1)); end if;
        continue;
      end if;
      if v_email is not null then seen_e := seen_e || v_email; end if; if v_doc is not null then seen_d := seen_d || v_doc; end if; if v_ext is not null then seen_x := seen_x || v_ext; end if;
      insert into public.customers (organization_id, name, email, phone, company_name, document_number, customer_type, external_customer_id, notes)
      values (p_org, v_name, v_email, v_phone, nullif(left(btrim(coalesce(r ->> 'company_name', '')), 160), ''), v_doc, v_type, v_ext, nullif(left(btrim(coalesce(r ->> 'notes', '')), 4000), ''));
      ok := ok + 1;
    end loop;
    if p_apply then update public.import_jobs set status = 'completed', accepted_rows = ok, rejected_rows = bad, duplicate_rows = dups, completed_at = now() where id = job; end if;
    if not p_apply then raise exception 'prévia' using errcode = 'PV001'; end if;
  exception when sqlstate 'PV001' then null;
  end;
  if p_apply and ok > 0 then perform private.pv_notify(p_org, (select auth.uid()), 'import_done', 'Importação de clientes concluída', ok || ' cliente(s) importado(s).', '/clientes', 'imp:' || job); end if;
  return jsonb_build_object('total', i, 'accepted', ok, 'duplicates', dups, 'invalid', bad, 'lines', errs, 'applied', p_apply, 'job_id', job);
end $$;

create function public.pv_import_purchases(p_org uuid, p_file_name text, p_hash text, p_rows jsonb, p_apply boolean, p_create_missing boolean default false, p_mapping jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb; i int := 0; ok int := 0; dups int := 0; bad int := 0; created_c int := 0; errs jsonb := '[]'::jsonb; job uuid; tz text := private.pv_tz(p_org); msg text;
  v_order text; v_cust uuid; v_at timestamptz; v_total bigint; v_status text; v_refund bigint; pid uuid; key text; qty numeric; unitp bigint; itot bigint; v_name text; had boolean; already boolean; prior uuid;
  seen_order text[] := '{}'; seen_pid uuid[] := '{}'; seen_expl boolean[] := '{}'; k int; had_file boolean := false;
begin
  perform private.pv_assert_manager(p_org);
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then raise exception 'envie até 2.000 linhas' using errcode = '22023'; end if;
  if nullif(p_hash, '') is not null then had_file := exists (select 1 from public.import_jobs where organization_id = p_org and kind = 'purchases' and file_hash = p_hash and status = 'completed'); end if;
  begin
    if p_apply then insert into public.import_jobs (organization_id, kind, file_name, file_hash, mapping_json, total_rows) values (p_org, 'purchases', left(coalesce(p_file_name, 'arquivo.csv'), 200), nullif(p_hash, ''), coalesce(p_mapping, '{}'), jsonb_array_length(p_rows)) returning id into job; end if;
    for r in select value from jsonb_array_elements(p_rows) loop
      i := i + 1; msg := null; pid := null;
      v_order := nullif(left(btrim(coalesce(r ->> 'order_id', '')), 80), '');
      v_at := private.pv_parse_date(btrim(coalesce(r ->> 'date', '')), tz);
      v_status := lower(coalesce(nullif(btrim(r ->> 'status'), ''), 'completed'));
      begin v_total := nullif(btrim(coalesce(r ->> 'total_cents', '')), '')::bigint; exception when others then v_total := -1; end;
      begin v_refund := coalesce(nullif(btrim(coalesce(r ->> 'refunded_cents', '')), '')::bigint, 0); exception when others then v_refund := -1; end;
      begin qty := coalesce(nullif(btrim(coalesce(r ->> 'quantity', '')), '')::numeric, 1); exception when others then qty := -1; end;
      begin unitp := coalesce(nullif(btrim(coalesce(r ->> 'unit_price_cents', '')), '')::bigint, 0); exception when others then unitp := -1; end;
      itot := case when unitp >= 0 and qty > 0 then round(unitp * qty)::bigint else 0 end;
      v_cust := private.pv_find_customer(p_org, r ->> 'customer_external_id', r ->> 'customer_document', r ->> 'customer_email');
      if v_at is null then msg := 'Data inválida (use AAAA-MM-DD).';
      elsif v_at > now() + interval '1 day' then msg := 'Data no futuro.';
      elsif v_status not in ('completed', 'cancelled') then msg := 'Status inválido (completed ou cancelled).';
      elsif v_total is not null and (v_total < 0 or v_total > 100000000000) then msg := 'Valor inválido.';
      elsif v_total is null and itot = 0 then msg := 'Informe o valor da compra.';
      elsif v_refund < 0 or qty <= 0 or unitp < 0 then msg := 'Quantidade, preço ou estorno inválido.';
      elsif v_cust is null and not (p_create_missing and nullif(btrim(coalesce(r ->> 'customer_name', '')), '') is not null
              and (private.pv_norm_email(r ->> 'customer_email') is not null or private.pv_norm_doc(r ->> 'customer_document') is not null or nullif(btrim(coalesce(r ->> 'customer_external_id', '')), '') is not null)) then
        msg := 'Cliente não encontrado (informe e-mail, documento ou identificador do cliente).';
      end if;
      if msg is not null then
        bad := bad + 1;
        if p_apply then insert into public.import_row_errors (organization_id, import_job_id, row_number, error_code, error_message) values (p_org, job, i + 1, 'invalid', msg); end if;
        if jsonb_array_length(errs) < 50 then errs := errs || to_jsonb(format('Linha %s: %s', i + 1, msg)); end if;
        continue;
      end if;
      if v_cust is null then
        v_name := left(btrim(r ->> 'customer_name'), 160);
        begin
          insert into public.customers (organization_id, name, email, document_number, external_customer_id)
          values (p_org, v_name, private.pv_norm_email(r ->> 'customer_email'), private.pv_norm_doc(r ->> 'customer_document'), nullif(left(btrim(coalesce(r ->> 'customer_external_id', '')), 80), '')) returning id into v_cust;
          created_c := created_c + 1;
        exception when unique_violation or check_violation then
          bad := bad + 1; if jsonb_array_length(errs) < 50 then errs := errs || to_jsonb(format('Linha %s: dados do cliente inválidos.', i + 1)); end if; continue;
        end;
      end if;
      -- linha de item de um pedido já criado neste arquivo?
      if v_order is not null and v_order = any (seen_order) then
        k := array_position(seen_order, v_order); pid := seen_pid[k];
        if pid is null then dups := dups + 1; if jsonb_array_length(errs) < 50 then errs := errs || to_jsonb(format('Linha %s: item de pedido que já existe.', i + 1)); end if; continue; end if;
        if coalesce(r ->> 'product', '') <> '' then
          insert into public.purchase_items (organization_id, purchase_id, product_name, product_sku, category, quantity, unit_price_cents, total_cents)
          values (p_org, pid, left(btrim(r ->> 'product'), 200), nullif(left(btrim(coalesce(r ->> 'sku', '')), 80), ''), nullif(left(btrim(coalesce(r ->> 'category', '')), 80), ''), qty, unitp, itot);
          if v_total is null and not seen_expl[k] then update public.purchases set total_cents = total_cents + itot where id = pid; end if;
        end if;
        continue;
      end if;
      if v_order is not null then
        select id into prior from public.purchases where organization_id = p_org and external_order_id = v_order;
        if prior is not null then
          dups := dups + 1; if jsonb_array_length(errs) < 50 then errs := errs || to_jsonb(format('Linha %s: pedido %s já existe.', i + 1, v_order)); end if;
          if p_apply then insert into public.import_row_errors (organization_id, import_job_id, row_number, error_code, error_message) values (p_org, job, i + 1, 'duplicate', 'Pedido já cadastrado.'); end if;
          seen_order := seen_order || v_order; seen_pid := seen_pid || null::uuid; seen_expl := seen_expl || true; -- itens seguintes do mesmo pedido também são ignorados
          continue;
        end if;
        key := null;
      else
        key := md5(v_cust::text || '|' || extract(epoch from v_at)::bigint || '|' || coalesce(v_total, itot));
        if exists (select 1 from public.purchases where organization_id = p_org and dedup_key = key) then
          dups := dups + 1; if jsonb_array_length(errs) < 50 then errs := errs || to_jsonb(format('Linha %s: possível compra duplicada (mesmo cliente, data e valor).', i + 1)); end if;
          if p_apply then insert into public.import_row_errors (organization_id, import_job_id, row_number, error_code, error_message) values (p_org, job, i + 1, 'possible_duplicate', 'Possível compra duplicada.'); end if;
          continue;
        end if;
      end if;
      select exists (select 1 from public.purchases where customer_id = v_cust and is_valid) into had;
      insert into public.purchases (organization_id, customer_id, external_order_id, dedup_key, purchased_at, total_cents, refunded_cents, status, source, import_job_id)
      values (p_org, v_cust, v_order, key, v_at, coalesce(v_total, itot), least(greatest(v_refund, 0), coalesce(v_total, itot)), v_status::public.pv_purchase_status, 'importação', job) returning id into pid;
      if coalesce(r ->> 'product', '') <> '' then
        insert into public.purchase_items (organization_id, purchase_id, product_name, product_sku, category, quantity, unit_price_cents, total_cents)
        values (p_org, pid, left(btrim(r ->> 'product'), 200), nullif(left(btrim(coalesce(r ->> 'sku', '')), 80), ''), nullif(left(btrim(coalesce(r ->> 'category', '')), 80), ''), qty, unitp, itot);
      end if;
      if v_order is not null then seen_order := seen_order || v_order; seen_pid := seen_pid || pid; seen_expl := seen_expl || (v_total is not null); end if;
      if v_status = 'completed' then
        insert into public.customer_lifecycle_events (organization_id, customer_id, event_type, event_key, metadata, occurred_at)
        values (p_org, v_cust, case when had then 'purchase' else 'first_purchase' end, 'purchase:' || pid, jsonb_build_object('purchase_id', pid), v_at) on conflict do nothing;
      end if;
      ok := ok + 1;
    end loop;
    if p_apply then
      update public.import_jobs set status = 'completed', accepted_rows = ok, rejected_rows = bad, duplicate_rows = dups, completed_at = now() where id = job;
      perform private.pv_detect_reactivations(p_org);
    end if;
    if not p_apply then raise exception 'prévia' using errcode = 'PV001'; end if;
  exception when sqlstate 'PV001' then null;
  end;
  if p_apply and ok > 0 then perform private.pv_notify(p_org, (select auth.uid()), 'import_done', 'Importação de compras concluída', ok || ' compra(s) importada(s).', '/compras', 'imp:' || job); end if;
  return jsonb_build_object('total', i, 'accepted', ok, 'duplicates', dups, 'invalid', bad, 'customers_created', created_c, 'lines', errs, 'applied', p_apply, 'job_id', job, 'already_imported_file', had_file);
end $$;

-- ======================================================================= clientes: atribuição, LGPD
create function public.pv_assign_customer(p_customer uuid, p_to uuid) returns void language plpgsql security definer set search_path = '' as $$
declare c public.customers%rowtype;
begin
  select * into c from public.customers where id = p_customer;
  if not found then raise exception 'cliente não encontrado' using errcode = 'P0002'; end if;
  perform private.pv_assert_manager(c.organization_id);
  if p_to is not null and not exists (select 1 from public.organization_members m where m.organization_id = c.organization_id and m.user_id = p_to and m.role <> 'viewer') then raise exception 'responsável inválido' using errcode = '22023'; end if;
  update public.customers set assigned_to = p_to where id = p_customer;
  update public.reactivation_opportunities set assigned_to = p_to where customer_id = p_customer and status in ('open', 'in_progress');
end $$;

create function public.pv_anonymize_customer(p_customer uuid) returns void language plpgsql security definer set search_path = '' as $$
declare c public.customers%rowtype;
begin
  select * into c from public.customers where id = p_customer;
  if not found then raise exception 'cliente não encontrado' using errcode = 'P0002'; end if;
  perform private.pv_assert_admin(c.organization_id);
  update public.customers set anonymized_at = now(), name = 'Anonimizado', email = null, phone = null, company_name = null, document_number = null, external_customer_id = null, notes = null, custom = '{}'::jsonb where id = p_customer;
  update public.customer_activities set description = null, title = null where customer_id = p_customer;
  update public.campaign_contacts set notes = null where customer_id = p_customer;
  delete from public.communication_preferences where customer_id = p_customer;
end $$;

-- ======================================================================= permissões de comunicação e supressão
create function public.pv_set_preference(p_customer uuid, p_channel public.pv_channel, p_status public.pv_permission, p_basis text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.customers%rowtype;
begin
  c := private.pv_assert_writer(p_customer);
  if c.anonymized_at is not null then raise exception 'cliente anonimizado' using errcode = '23514'; end if;
  if p_status in ('granted', 'legitimate_interest') and nullif(btrim(coalesce(p_basis, '')), '') is null then raise exception 'informe a base legal ou a referência do consentimento' using errcode = '23514'; end if;
  insert into public.communication_preferences (organization_id, customer_id, channel, permission_status, legal_basis_reference)
  values (c.organization_id, p_customer, p_channel, p_status, left(nullif(btrim(coalesce(p_basis, '')), ''), 300))
  on conflict (customer_id, channel) do update set permission_status = excluded.permission_status, legal_basis_reference = excluded.legal_basis_reference, updated_by = (select auth.uid()), updated_at = now();
end $$;

-- Registra a mesma base legal para quem ainda NÃO tem preferência no canal (ação explícita da gestão; nunca sobrescreve).
create function public.pv_set_preference_bulk(p_org uuid, p_channel public.pv_channel, p_status public.pv_permission, p_basis text) returns integer
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform private.pv_assert_manager(p_org);
  if nullif(btrim(coalesce(p_basis, '')), '') is null then raise exception 'informe a base legal ou a referência do consentimento' using errcode = '23514'; end if;
  insert into public.communication_preferences (organization_id, customer_id, channel, permission_status, legal_basis_reference)
  select p_org, c.id, p_channel, p_status, left(btrim(p_basis), 300) from public.customers c
  where c.organization_id = p_org and c.archived_at is null and c.anonymized_at is null
    and not exists (select 1 from public.communication_preferences cp where cp.customer_id = c.id and cp.channel = p_channel)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

create function public.pv_suppress(p_customer uuid, p_channel public.pv_channel, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.customers%rowtype;
begin
  c := private.pv_assert_writer(p_customer);
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'informe o motivo' using errcode = '23514'; end if;
  insert into public.suppression_entries (organization_id, customer_id, channel, reason) values (c.organization_id, p_customer, p_channel, left(btrim(p_reason), 300));
  -- membros de campanhas em andamento deixam de receber contato
  update public.campaign_memberships m set status = 'excluded', exclusion_reason = 'suprimido'
   where m.customer_id = p_customer and m.status in ('eligible', 'assigned') and exists (select 1 from public.campaigns k where k.id = m.campaign_id and k.status in ('draft', 'planned', 'running', 'paused') and (p_channel is null or k.channel = p_channel));
end $$;

create function public.pv_lift_suppression(p_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare s public.suppression_entries%rowtype;
begin
  select * into s from public.suppression_entries where id = p_id;
  if not found then raise exception 'registro não encontrado' using errcode = 'P0002'; end if;
  perform private.pv_assert_manager(s.organization_id);
  update public.suppression_entries set lifted_at = now() where id = p_id and lifted_at is null;
end $$;

-- Elegibilidade para contato por canal: nulo = elegível; senão o motivo. Ausência de preferência NÃO é consentimento.
create function private.pv_eligibility(cust uuid, ch public.pv_channel) returns text
language plpgsql stable security definer set search_path = '' as $$
declare c public.customers%rowtype; pref public.pv_permission;
begin
  select * into c from public.customers where id = cust;
  if not found or c.archived_at is not null then return 'arquivado'; end if;
  if c.anonymized_at is not null then return 'anonimizado'; end if;
  if exists (select 1 from public.suppression_entries s where s.customer_id = cust and s.lifted_at is null and (s.channel is null or s.channel = ch)) then return 'suprimido'; end if;
  select permission_status into pref from public.communication_preferences where customer_id = cust and channel = ch;
  if pref is null then return 'sem_permissao_registrada'; end if;
  if pref = 'denied' then return 'permissao_negada'; end if;
  return null;
end $$;
revoke all on function private.pv_eligibility(uuid, public.pv_channel) from public;

-- ======================================================================= campanhas
-- Fotografia do público: integrantes do segmento + elegibilidade por canal. Reexecutável enquanto não houve contato.
create function public.pv_campaign_snapshot(p_campaign uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.campaigns%rowtype; sd public.segment_definitions%rowtype; r record; why text; el int := 0; ex int := 0; run uuid;
begin
  select * into c from public.campaigns where id = p_campaign for update;
  if not found then raise exception 'campanha não encontrada' using errcode = 'P0002'; end if;
  perform private.pv_assert_manager(c.organization_id);
  if c.status not in ('draft', 'planned') then raise exception 'o público só pode ser recalculado em rascunho ou planejada' using errcode = '23514'; end if;
  if c.segment_id is null then raise exception 'escolha um segmento' using errcode = '23514'; end if;
  select * into sd from public.segment_definitions where id = c.segment_id;
  select id into run from public.rfm_runs where organization_id = c.organization_id order by model_version desc limit 1;
  delete from public.campaign_memberships where campaign_id = p_campaign;
  for r in
    select m.customer_id, g.state, g.days_since, sc.segment_key as seg, cu.assigned_to
    from public.pv_segment_members(c.organization_id, sd.criteria_json) m
    join public.pv_customer_signals(c.organization_id, private.pv_today(c.organization_id)) g on g.customer_id = m.customer_id
    join public.customers cu on cu.id = m.customer_id
    left join public.customer_rfm_scores sc on sc.customer_id = m.customer_id and sc.run_id = run
  loop
    why := private.pv_eligibility(r.customer_id, c.channel);
    insert into public.campaign_memberships (organization_id, campaign_id, customer_id, eligibility_snapshot_json, status, exclusion_reason, assigned_to)
    values (c.organization_id, p_campaign, r.customer_id, jsonb_build_object('state', r.state, 'days_since_last', r.days_since, 'rfm_segment', r.seg, 'channel', c.channel, 'segment', sd.name),
            case when why is null then (case when r.assigned_to is null then 'eligible' else 'assigned' end)::public.pv_member_status else 'excluded' end, why, r.assigned_to);
    if why is null then el := el + 1; else ex := ex + 1; end if;
  end loop;
  return jsonb_build_object('eligible', el, 'excluded', ex);
end $$;

create function public.pv_campaign_set_status(p_campaign uuid, p_status public.pv_campaign_status) returns void language plpgsql security definer set search_path = '' as $$
declare c public.campaigns%rowtype; ok boolean;
begin
  select * into c from public.campaigns where id = p_campaign for update;
  if not found then raise exception 'campanha não encontrada' using errcode = 'P0002'; end if;
  perform private.pv_assert_manager(c.organization_id);
  if c.status = p_status then return; end if;
  ok := (c.status = 'draft' and p_status in ('planned', 'running', 'cancelled')) or (c.status = 'planned' and p_status in ('draft', 'running', 'cancelled'))
     or (c.status = 'running' and p_status in ('paused', 'completed', 'cancelled')) or (c.status = 'paused' and p_status in ('running', 'completed', 'cancelled'));
  if not ok then raise exception 'transição de campanha não permitida: % -> %', c.status, p_status using errcode = '23514'; end if;
  if p_status in ('planned', 'running') and not exists (select 1 from public.campaign_memberships where campaign_id = p_campaign) then
    raise exception 'calcule o público da campanha antes de planejá-la ou iniciá-la' using errcode = '23514';
  end if;
  update public.campaigns set status = p_status,
    started_at = case when p_status = 'running' and started_at is null then now() else started_at end,
    completed_at = case when p_status in ('completed', 'cancelled') then now() else completed_at end where id = p_campaign;
  if p_status = 'completed' then
    perform private.pv_campaign_sync(p_campaign);
    perform private.pv_notify(c.organization_id, (select auth.uid()), 'campaign_done', 'Campanha concluída', c.name, '/campanhas/' || p_campaign, 'camp:' || p_campaign);
  end if;
end $$;

-- Registro MANUAL de contato: não comprova entrega de mensagem. Reconfere permissão e supressão no momento do contato.
create function public.pv_campaign_log_contact(p_campaign uuid, p_customer uuid, p_status public.pv_contact_status, p_notes text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.campaigns%rowtype; cu public.customers%rowtype; m public.campaign_memberships%rowtype; why text; ms public.pv_member_status;
begin
  cu := private.pv_assert_writer(p_customer);
  select * into c from public.campaigns where id = p_campaign;
  if not found then raise exception 'campanha não encontrada' using errcode = 'P0002'; end if;
  if c.status <> 'running' then raise exception 'a campanha precisa estar em andamento' using errcode = '23514'; end if;
  select * into m from public.campaign_memberships where campaign_id = p_campaign and customer_id = p_customer;
  if not found or m.status = 'excluded' then raise exception 'cliente fora do público desta campanha' using errcode = '23514'; end if;
  why := private.pv_eligibility(p_customer, c.channel);
  if why is not null then raise exception 'cliente não pode ser contatado neste canal: %', why using errcode = '23514'; end if;
  insert into public.campaign_contacts (organization_id, campaign_id, customer_id, contact_method, contact_status, contacted_at, notes)
  values (c.organization_id, p_campaign, p_customer, c.channel, p_status, case when p_status = 'planned' then null else now() end, left(p_notes, 2000));
  ms := case p_status when 'planned' then 'assigned' when 'contacted' then 'contacted' when 'responded' then 'responded' when 'no_response' then 'no_response' else 'refused' end;
  update public.campaign_memberships set status = case when status = 'rebought' then status else ms end where id = m.id;
  if p_status <> 'planned' then
    insert into public.customer_lifecycle_events (organization_id, customer_id, event_type, metadata) values (c.organization_id, p_customer, 'contact', jsonb_build_object('campaign_id', p_campaign, 'status', p_status));
    update public.reactivation_opportunities set last_contact_at = now(), status = case when status = 'open' then 'in_progress' else status end where customer_id = p_customer and status in ('open', 'in_progress');
  end if;
  if p_status = 'refused' then
    insert into public.suppression_entries (organization_id, customer_id, channel, reason) values (c.organization_id, p_customer, c.channel, 'Recusou contato na campanha ' || left(c.name, 80));
  end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.pv_purchase_create(uuid, text, timestamptz, bigint, jsonb, text, text, boolean)', 'public.pv_purchase_cancel(uuid)', 'public.pv_purchase_refund(uuid, bigint)',
    'public.pv_import_customers(uuid, text, text, jsonb, boolean, jsonb)', 'public.pv_import_purchases(uuid, text, text, jsonb, boolean, boolean, jsonb)',
    'public.pv_assign_customer(uuid, uuid)', 'public.pv_anonymize_customer(uuid)', 'public.pv_set_preference(uuid, public.pv_channel, public.pv_permission, text)',
    'public.pv_set_preference_bulk(uuid, public.pv_channel, public.pv_permission, text)', 'public.pv_suppress(uuid, public.pv_channel, text)', 'public.pv_lift_suppression(uuid)',
    'public.pv_campaign_snapshot(uuid)', 'public.pv_campaign_set_status(uuid, public.pv_campaign_status)', 'public.pv_campaign_log_contact(uuid, uuid, public.pv_contact_status, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
