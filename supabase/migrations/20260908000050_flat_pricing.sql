-- 종가 단일가 체결 모드 (flat_pricing) — 초보용.
--
-- 차트·장중 252스텝 애니메이션·펄스 점·일/월/년 타임프레임은 전부 그대로 살아 있다
-- (시각적 흐름 관찰용). 바뀌는 건 체결가 한 곳뿐 — 장중 어느 시점에 주문을 넣어도
-- current_price(그 해 종가 스칼라)로 체결된다 → 차트 단타가 무의미해지고, 학생이
-- 재무제표·힌트로 판단하게 유도된다.
--
-- 기본값 false(장중 스텝 체결 유지 = 0043~0044 동작). 관리자가 게임 설정에서 켠다(시작 전에만).

alter table game_state add column if not exists flat_pricing boolean not null default false;
comment on column game_state.flat_pricing is
  'true면 place_order·옵션 스팟이 장중 스텝값 대신 current_price(그 해 종가)로 체결한다. 차트/애니메이션/타임프레임은 영향 없음.';

-- ─────────────────────────────────────────────
-- exec_price — flat_pricing이면 경로 조회 전에 current_price로 단락.
-- 나머지(경로 스텝 체결)는 0043과 동일.
-- ─────────────────────────────────────────────
create or replace function private.exec_price(p_stock_id text)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_year int;
  v_path numeric[];
  v_idx int;
  v_flat boolean;
begin
  select flat_pricing into v_flat from game_state where id = 1;
  if coalesce(v_flat, false) then
    return current_price(p_stock_id);           -- 종가 단일가 체결 모드
  end if;

  select coalesce(
           (g.round_year_map ->> g.current_round::text)::int,
           g.final_year
         )
    into v_year
  from game_state g where g.id = 1;

  select prices into v_path
  from stock_price_paths
  where stock_id = p_stock_id and year = v_year;

  if v_path is null then
    return current_price(p_stock_id); -- 하위호환: 경로 없는 종목/연도
  end if;

  v_idx := private.round_step_idx();           -- 0..251
  return greatest(0, round(v_path[v_idx + 1])::bigint); -- PG 배열은 1-인덱스
end;
$$;

grant execute on function private.exec_price(text) to anon, authenticated;

-- ─────────────────────────────────────────────
-- admin_update_game_config — p_flat_pricing 추가.
-- 옛 시그니처 drop → 오버로드로 무방비 버전이 남는 걸 방지.
-- ─────────────────────────────────────────────
drop function if exists admin_update_game_config(text, int, jsonb, int, bigint, int, text);
create or replace function admin_update_game_config(
  p_admin_secret text, p_total_rounds int, p_round_year_map jsonb,
  p_final_year int, p_default_seed bigint, p_duration_minutes int,
  p_join_mode text default null, p_flat_pricing boolean default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_cur int;
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  select current_round into v_cur from game_state where id = 1 for update;
  if v_cur > 0 then
    return jsonb_build_object('ok', false, 'error', 'game_already_started');
  end if;
  if p_join_mode is not null and p_join_mode not in ('code', 'open') then
    return jsonb_build_object('ok', false, 'error', 'bad_join_mode');
  end if;
  update game_state set
    total_rounds = coalesce(p_total_rounds, total_rounds),
    round_year_map = coalesce(p_round_year_map, round_year_map),
    final_year = coalesce(p_final_year, final_year),
    default_seed = coalesce(p_default_seed, default_seed),
    round_duration_seconds = coalesce(p_duration_minutes * 60, round_duration_seconds),
    join_mode = coalesce(p_join_mode, join_mode),
    flat_pricing = coalesce(p_flat_pricing, flat_pricing)
  where id = 1;
  perform emit_signal('stocks_changed', jsonb_build_object('config', true));
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function admin_update_game_config(text, int, jsonb, int, bigint, int, text, boolean) to anon, authenticated;
