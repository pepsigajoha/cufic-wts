-- 콘텐츠를 DB로 (B, Phase 1b): 재무제표·시황을 관리자 화면에서 편집하는 RPC.
-- 쓰기는 정책 없이 security definer + verify_admin으로만. 저장하면 content_changed 신호를 흘려
-- 학생·관리자 화면이 재조회한다.

-- ── 시황 upsert
create or replace function admin_upsert_macro(
  p_admin_secret text, p_year int, p_summary text,
  p_rate numeric, p_gdp numeric, p_unemployment numeric, p_fx int, p_cpi numeric, p_oil int
) returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  insert into macro (year, summary, rate, gdp, unemployment, fx, cpi, oil)
  values (p_year, coalesce(p_summary, ''), p_rate, p_gdp, p_unemployment, p_fx, p_cpi, p_oil)
  on conflict (year) do update set
    summary = excluded.summary, rate = excluded.rate, gdp = excluded.gdp,
    unemployment = excluded.unemployment, fx = excluded.fx, cpi = excluded.cpi, oil = excluded.oil;
  perform emit_signal('content_changed', jsonb_build_object('kind', 'macro', 'year', p_year));
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function admin_upsert_macro(text, int, text, numeric, numeric, numeric, int, numeric, int) to anon, authenticated;

-- ── 재무제표 upsert
create or replace function admin_upsert_financial(
  p_admin_secret text, p_stock_id text, p_year int,
  p_revenue bigint, p_op_income bigint, p_net_income bigint, p_debt_ratio numeric, p_roe numeric
) returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  if not exists (select 1 from stocks where id = p_stock_id) then
    return jsonb_build_object('ok', false, 'error', 'stock_not_found');
  end if;
  insert into financials (stock_id, year, revenue, op_income, net_income, debt_ratio, roe)
  values (p_stock_id, p_year, p_revenue, p_op_income, p_net_income, p_debt_ratio, p_roe)
  on conflict (stock_id, year) do update set
    revenue = excluded.revenue, op_income = excluded.op_income, net_income = excluded.net_income,
    debt_ratio = excluded.debt_ratio, roe = excluded.roe;
  perform emit_signal('content_changed', jsonb_build_object('kind', 'financial', 'stock_id', p_stock_id, 'year', p_year));
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function admin_upsert_financial(text, text, int, bigint, bigint, bigint, numeric, numeric) to anon, authenticated;

-- ── 재무제표 삭제 (미상장/폐지 연도 = 행 없음)
create or replace function admin_delete_financial(p_admin_secret text, p_stock_id text, p_year int)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  delete from financials where stock_id = p_stock_id and year = p_year;
  perform emit_signal('content_changed', jsonb_build_object('kind', 'financial', 'stock_id', p_stock_id, 'year', p_year));
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function admin_delete_financial(text, text, int) to anon, authenticated;
