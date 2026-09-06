-- 분기별(63거래일) 파라미터·이벤트를 라운드 단위로 서버에 저장한다.
--
-- 배경: AdminSimulator "분기별 파라미터" 카드의 drift·σ·분기 속보·힌트는 지금 그 관리자
-- 브라우저 sessionStorage에만 산다 — 새로고침·타 기기·학생 화면 어디에서도 못 읽는다.
-- 이 테이블이 그걸 라운드별로 남겨서 ① 재현·감사, ② 데이터셋 저장/복원에 포함,
-- ③ 학생 화면에 "지금 분기까지만" 공개(스포일러 게이트)를 가능하게 한다.
--
-- [스포일러 — round_configs(0038)와 같은 원칙]
-- drift·σ는 "미래 라운드 가격을 만드는 입력값"이라 학생이 보면 다음 등락을 계산할 수 있다.
-- 그래서 RLS를 켜되 select 정책을 만들지 않는다(anon 전면 차단). 학생은 get_quarter_events()
-- 로만 읽고, 그 함수도 "현재 라운드 · 현재 분기까지 · eventNews/hintText만" 돌려준다.

-- ─────────────────────────────────────────────
-- 1. 테이블
-- ─────────────────────────────────────────────
create table if not exists round_quarter_configs (
  round int primary key,
  -- [{quarter:1..4, drift:number, volatility:number, eventNews:string, hintText:string} × 4]
  quarters jsonb not null,
  updated_at timestamptz not null default now(),
  constraint round_quarter_configs_len4
    check (jsonb_typeof(quarters) = 'array' and jsonb_array_length(quarters) = 4)
);

comment on table round_quarter_configs is
  'src/quarters.js QuarterConfig 4개를 라운드별로. drift·σ는 스포일러 → select 정책 없음, admin_* RPC와 get_quarter_events()로만 접근.';

alter table round_quarter_configs enable row level security;
-- select 정책 없음 = anon 전면 차단(의도적).

-- ─────────────────────────────────────────────
-- 2. 관리자 저장/조회/삭제 (round_configs와 동일 패턴)
-- ─────────────────────────────────────────────
create or replace function admin_upsert_round_quarter_config(
  p_admin_secret text,
  p_round int,
  p_quarters jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  if p_round is null or p_round < 1 then
    return jsonb_build_object('ok', false, 'error', 'invalid_round');
  end if;
  if p_quarters is null or jsonb_typeof(p_quarters) <> 'array' or jsonb_array_length(p_quarters) <> 4 then
    return jsonb_build_object('ok', false, 'error', 'invalid_quarters');
  end if;

  insert into round_quarter_configs (round, quarters, updated_at)
  values (p_round, p_quarters, now())
  on conflict (round) do update
    set quarters = excluded.quarters, updated_at = now();

  perform emit_signal('content_changed', jsonb_build_object('kind', 'quarter_configs', 'round', p_round));
  return jsonb_build_object('ok', true, 'round', p_round);
end;
$$;

create or replace function admin_list_round_quarter_configs(p_admin_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_rows jsonb;
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'round', round, 'quarters', quarters, 'updated_at', updated_at
         ) order by round), '[]'::jsonb)
    into v_rows
  from round_quarter_configs;

  return jsonb_build_object('ok', true, 'configs', v_rows);
end;
$$;

create or replace function admin_delete_round_quarter_config(p_admin_secret text, p_round int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  delete from round_quarter_configs where round = p_round;
  perform emit_signal('content_changed', jsonb_build_object('kind', 'quarter_configs', 'round', p_round));
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function admin_upsert_round_quarter_config(text, int, jsonb) to anon, authenticated;
grant execute on function admin_list_round_quarter_configs(text) to anon, authenticated;
grant execute on function admin_delete_round_quarter_config(text, int) to anon, authenticated;

-- ─────────────────────────────────────────────
-- 3. 학생용 — 현재 라운드 · 현재 분기까지 · eventNews/hintText만 (스포일러 게이트)
--    분기 인덱스 공식은 private.round_step_idx()(0043) / src/quarters.js quarterOfStep과 동일.
--    타이머 미시작(round_start_at is null)·잠금·미시작·종료면 빈 배열.
-- ─────────────────────────────────────────────
create or replace function get_quarter_events()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_round int;
  v_locked boolean;
  v_ended boolean;
  v_start timestamptz;
  v_step int;
  v_cur_q int;
  v_quarters jsonb;
  v_out jsonb;
begin
  select current_round, is_locked, is_ended, round_start_at
    into v_round, v_locked, v_ended, v_start
  from game_state where id = 1;

  if v_round is null or v_round < 1 or v_locked or v_ended or v_start is null then
    return '[]'::jsonb;
  end if;

  select quarters into v_quarters
  from round_quarter_configs where round = v_round;
  if v_quarters is null then
    return '[]'::jsonb;
  end if;

  v_step := private.round_step_idx();                 -- 0..251
  v_cur_q := least(4, greatest(1, (v_step / 63) + 1)); -- 1..4 (63 = 252/4)

  select coalesce(jsonb_agg(jsonb_build_object(
           'quarter', (e->>'quarter')::int,
           'eventNews', coalesce(e->>'eventNews', ''),
           'hintText', coalesce(e->>'hintText', '')
         ) order by (e->>'quarter')::int), '[]'::jsonb)
    into v_out
  from jsonb_array_elements(v_quarters) e
  where (e->>'quarter')::int <= v_cur_q
    and (coalesce(e->>'eventNews', '') <> '' or coalesce(e->>'hintText', '') <> '');

  return v_out;
end;
$$;

grant execute on function get_quarter_events() to anon, authenticated;

-- ─────────────────────────────────────────────
-- 4. 데이터셋 스냅샷/복원에 quarter_configs 포함 (0034 정의 + 추가, null-safe)
-- ─────────────────────────────────────────────
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
    'macro', (select coalesce(jsonb_agg(jsonb_build_object('year', year, 'summary', summary,
        'kospi', kospi, 'sp500', sp500, 'nikkei', nikkei, 'europe', europe,
        'rate', rate, 'cpi', cpi, 'oil', oil, 'gold', gold) order by year), '[]'::jsonb) from macro),
    'hints', (select coalesce(jsonb_agg(jsonb_build_object('round', round, 'grade', grade, 'headline', headline,
        'impact', impact, 'related_stock_ids', related_stock_ids)), '[]'::jsonb) from hints),
    'quarter_configs', (select coalesce(jsonb_agg(jsonb_build_object('round', round, 'quarters', quarters)
        order by round), '[]'::jsonb) from round_quarter_configs)
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
  delete from round_quarter_configs where true;
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

  insert into macro (year, summary, kospi, sp500, nikkei, europe, rate, cpi, oil, gold)
  select (m->>'year')::int, coalesce(m->>'summary',''),
         (m->>'kospi')::int, (m->>'sp500')::int, (m->>'nikkei')::int, (m->>'europe')::int,
         (m->>'rate')::numeric, (m->>'cpi')::numeric, (m->>'oil')::int, (m->>'gold')::int
  from jsonb_array_elements(v_data->'macro') m;

  insert into hints (round, grade, headline, impact, related_stock_ids)
  select (h->>'round')::int,h->>'grade',h->>'headline',h->>'impact',
         coalesce((select array_agg(v) from jsonb_array_elements_text(h->'related_stock_ids') v),'{}')
  from jsonb_array_elements(v_data->'hints') h;

  -- quarter_configs: 옛 payload엔 이 키가 없다 → coalesce로 빈 배열 처리(안 깨짐)
  insert into round_quarter_configs (round, quarters, updated_at)
  select (q->>'round')::int, q->'quarters', now()
  from jsonb_array_elements(coalesce(v_data->'quarter_configs', '[]'::jsonb)) q
  where jsonb_typeof(q->'quarters') = 'array' and jsonb_array_length(q->'quarters') = 4;

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
