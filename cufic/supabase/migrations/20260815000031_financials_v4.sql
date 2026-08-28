-- 재무제표 구조 전면 교체 (v4): "5개 지표" → "입력 잎 7개 + 자동계산"
--
-- 입력 7개만 저장한다: 유동자산·비유동자산·유동부채·비유동부채 / 매출·영업비용·영업외비용.
--   자산합계·부채합계·자본·영업이익·당기순이익·부채비율·ROE는 저장하지 않고 프론트(src/metrics.js
--   deriveFinancials)에서 계산한다 — 단일 소스. (지표 정의는 metrics.js에만 있다.)
-- 기존 103행은 폐기(교보재팀이 v4 콘텐츠로 대체 예정). 라이브 표는 seed.sql(더미)로 재적재한다.
--
-- 주의: get_financials / admin_list_financials 는 `returns setof financials` 라 테이블 rowtype에
-- 묶여 있다. 컬럼 drop 전에 먼저 drop 했다가 재생성한다(의존성 오류 예방). admin_upsert_financial 은
-- 시그니처가 바뀌므로 옛 것을 반드시 drop 한다(안 그러면 오버로드로 무방비 버전이 남는다).

drop function if exists get_financials();
drop function if exists admin_list_financials(text);
drop function if exists admin_upsert_financial(text, text, int, bigint, bigint, bigint, numeric, numeric);

-- ── 스키마 교체: 옛 4개 컬럼 제거(revenue 는 유지), 입력 6개 추가
alter table financials
  drop column if exists op_income,
  drop column if exists net_income,
  drop column if exists debt_ratio,
  drop column if exists roe,
  add column if not exists current_assets bigint,
  add column if not exists noncurrent_assets bigint,
  add column if not exists current_liabilities bigint,
  add column if not exists noncurrent_liabilities bigint,
  add column if not exists operating_expense bigint,
  add column if not exists nonoperating_expense bigint;

-- 옛 데이터 폐기 (새 더미는 seed.sql 로 재적재)
delete from financials where true;

-- ── 학생 조회(현재 라운드 연도까지만) / 관리자 조회(전체) 재생성
create or replace function get_financials()
returns setof financials
language sql stable security definer set search_path = public
as $$
  select f.* from financials f where f.year <= public_year();
$$;
grant execute on function get_financials() to anon, authenticated;

create or replace function admin_list_financials(p_admin_secret text)
returns setof financials
language plpgsql stable security definer set search_path = public
as $$
begin
  if not private.verify_admin(p_admin_secret) then return; end if;
  return query select * from financials;
end;
$$;
grant execute on function admin_list_financials(text) to anon, authenticated;

-- ── 재무 입력 저장 (입력 7개만)
create or replace function admin_upsert_financial(
  p_admin_secret text, p_stock_id text, p_year int,
  p_current_assets bigint, p_noncurrent_assets bigint,
  p_current_liabilities bigint, p_noncurrent_liabilities bigint,
  p_revenue bigint, p_operating_expense bigint, p_nonoperating_expense bigint
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
  insert into financials (stock_id, year, current_assets, noncurrent_assets,
      current_liabilities, noncurrent_liabilities, revenue, operating_expense, nonoperating_expense)
  values (p_stock_id, p_year, p_current_assets, p_noncurrent_assets,
      p_current_liabilities, p_noncurrent_liabilities, p_revenue, p_operating_expense, p_nonoperating_expense)
  on conflict (stock_id, year) do update set
    current_assets = excluded.current_assets, noncurrent_assets = excluded.noncurrent_assets,
    current_liabilities = excluded.current_liabilities, noncurrent_liabilities = excluded.noncurrent_liabilities,
    revenue = excluded.revenue, operating_expense = excluded.operating_expense,
    nonoperating_expense = excluded.nonoperating_expense;
  perform emit_signal('content_changed', jsonb_build_object('kind', 'financial', 'stock_id', p_stock_id, 'year', p_year));
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function admin_upsert_financial(text, text, int, bigint, bigint, bigint, bigint, bigint, bigint, bigint) to anon, authenticated;

-- ── 데이터셋 스냅샷/복원: financials 키를 입력 7개로 교체
create or replace function snapshot_content()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'game', (select jsonb_build_object('total_rounds', total_rounds, 'round_year_map', round_year_map,
        'default_seed', default_seed, 'final_year', final_year, 'round_duration_seconds', round_duration_seconds)
      from game_state where id = 1),
    'stocks', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'description', description,
        'sector', sector, 'listed_from_round', listed_from_round, 'prices', prices, 'display_order', display_order)
      order by display_order), '[]'::jsonb) from stocks),
    'financials', (select coalesce(jsonb_agg(jsonb_build_object('stock_id', stock_id, 'year', year,
        'current_assets', current_assets, 'noncurrent_assets', noncurrent_assets,
        'current_liabilities', current_liabilities, 'noncurrent_liabilities', noncurrent_liabilities,
        'revenue', revenue, 'operating_expense', operating_expense, 'nonoperating_expense', nonoperating_expense)), '[]'::jsonb) from financials),
    'macro', (select coalesce(jsonb_agg(jsonb_build_object('year', year, 'summary', summary, 'rate', rate, 'gdp', gdp,
        'unemployment', unemployment, 'fx', fx, 'cpi', cpi, 'oil', oil) order by year), '[]'::jsonb) from macro),
    'hints', (select coalesce(jsonb_agg(jsonb_build_object('round', round, 'grade', grade, 'headline', headline,
        'impact', impact, 'related_stock_ids', related_stock_ids)), '[]'::jsonb) from hints)
  );
$$;
revoke all on function snapshot_content() from public, anon, authenticated;

create or replace function restore_content(v_data jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_game jsonb := v_data -> 'game';
begin
  delete from round_snapshots where true;
  delete from trades where true;
  delete from positions where true;
  delete from hint_grants where true;
  delete from broadcasts where true;
  delete from hints where true;
  delete from financials where true;
  delete from macro where true;
  delete from stocks where true;

  insert into stocks (id, name, description, sector, listed_from_round, prices, display_order)
  select s->>'id', s->>'name', coalesce(s->>'description',''), coalesce(s->>'sector',''),
         coalesce((s->>'listed_from_round')::int,1), s->'prices', coalesce((s->>'display_order')::int,0)
  from jsonb_array_elements(v_data->'stocks') s;

  insert into financials (stock_id, year, current_assets, noncurrent_assets,
      current_liabilities, noncurrent_liabilities, revenue, operating_expense, nonoperating_expense)
  select f->>'stock_id',(f->>'year')::int,
         (f->>'current_assets')::bigint,(f->>'noncurrent_assets')::bigint,
         (f->>'current_liabilities')::bigint,(f->>'noncurrent_liabilities')::bigint,
         (f->>'revenue')::bigint,(f->>'operating_expense')::bigint,(f->>'nonoperating_expense')::bigint
  from jsonb_array_elements(v_data->'financials') f;

  insert into macro (year, summary, rate, gdp, unemployment, fx, cpi, oil)
  select (m->>'year')::int,coalesce(m->>'summary',''),(m->>'rate')::numeric,(m->>'gdp')::numeric,
         (m->>'unemployment')::numeric,(m->>'fx')::int,(m->>'cpi')::numeric,(m->>'oil')::int
  from jsonb_array_elements(v_data->'macro') m;

  insert into hints (round, grade, headline, impact, related_stock_ids)
  select (h->>'round')::int,h->>'grade',h->>'headline',h->>'impact',
         coalesce((select array_agg(v) from jsonb_array_elements_text(h->'related_stock_ids') v),'{}')
  from jsonb_array_elements(v_data->'hints') h;

  update game_state set
    total_rounds=(v_game->>'total_rounds')::int, round_year_map=v_game->'round_year_map',
    default_seed=(v_game->>'default_seed')::bigint, final_year=(v_game->>'final_year')::int,
    round_duration_seconds=coalesce((v_game->>'round_duration_seconds')::int,600),
    current_round=0, is_ended=false, is_locked=false, round_ends_at=null
  where id=1;
  update teams set cash=seed where true;
end;
$$;
revoke all on function restore_content(jsonb) from public, anon, authenticated;
