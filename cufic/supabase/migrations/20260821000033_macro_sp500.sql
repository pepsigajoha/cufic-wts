-- 시황(macro)에 가상 글로벌 주가지수 'sp500' 추가 (거래 대상 아님, 시황 배경 지표).
-- MACRO_METRICS(src/metrics.js) 단일 소스에 지표를 늘렸으므로 DB 고정열 3곳을 맞춘다:
--   ① macro 테이블 컬럼  ② 데이터셋 스냅샷/복원(snapshot_content·restore_content)  ③ admin_upsert_macro 시그니처
-- get_macro()는 select m.* 라 자동 포함, 시황판(MarketModal)·엑셀 파서/생성은 MACRO_METRICS 기반이라 자동.

alter table macro add column if not exists sp500 int;  -- 지수 포인트(정수)

-- ── 데이터셋 스냅샷: macro에 sp500 포함 (리셋/복원 왕복) ────────────────────
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
        'unemployment', unemployment, 'fx', fx, 'cpi', cpi, 'oil', oil, 'sp500', sp500) order by year), '[]'::jsonb) from macro),
    'hints', (select coalesce(jsonb_agg(jsonb_build_object('round', round, 'grade', grade, 'headline', headline,
        'impact', impact, 'related_stock_ids', related_stock_ids)), '[]'::jsonb) from hints)
  );
$$;
revoke all on function snapshot_content() from public, anon, authenticated;

-- ── 데이터셋 복원(적용): macro에 sp500 포함 ──────────────────────────────────
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

  insert into macro (year, summary, rate, gdp, unemployment, fx, cpi, oil, sp500)
  select (m->>'year')::int,coalesce(m->>'summary',''),(m->>'rate')::numeric,(m->>'gdp')::numeric,
         (m->>'unemployment')::numeric,(m->>'fx')::int,(m->>'cpi')::numeric,(m->>'oil')::int,(m->>'sp500')::int
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

-- ── 관리자 시황 편집: 시그니처에 p_sp500 추가 (옛 시그니처 drop 후 재생성) ──────
drop function if exists admin_upsert_macro(text, int, text, numeric, numeric, numeric, int, numeric, int);
create or replace function admin_upsert_macro(
  p_admin_secret text, p_year int, p_summary text,
  p_rate numeric, p_gdp numeric, p_unemployment numeric, p_fx int, p_cpi numeric, p_oil int, p_sp500 int
) returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  insert into macro (year, summary, rate, gdp, unemployment, fx, cpi, oil, sp500)
  values (p_year, coalesce(p_summary, ''), p_rate, p_gdp, p_unemployment, p_fx, p_cpi, p_oil, p_sp500)
  on conflict (year) do update set
    summary = excluded.summary, rate = excluded.rate, gdp = excluded.gdp,
    unemployment = excluded.unemployment, fx = excluded.fx, cpi = excluded.cpi, oil = excluded.oil, sp500 = excluded.sp500;
  perform emit_signal('content_changed', jsonb_build_object('kind', 'macro', 'year', p_year));
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function admin_upsert_macro(text, int, text, numeric, numeric, numeric, int, numeric, int, int) to anon, authenticated;
