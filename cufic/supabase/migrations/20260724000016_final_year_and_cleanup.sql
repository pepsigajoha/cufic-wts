-- 최종 정산(final_year) + 타이머 분 입력 + 주문서 경로 삭제
--
-- 1) R1~R5(2020~2024) 매매 후, [대회 종료]가 2025 가격으로 최종 정산한다.
--    구현: admin_end_game이 current_round를 total_rounds+1로 올려 '최종 연도'를 공개한다.
--    current_price가 그 라운드엔 round_year_map에 없으니 final_year로 폴백 → 전 계산이 2025로 잡힌다.
-- 2) 타이머 길이를 관리자가 [타이머 시작] 때 분 단위로 지정할 수 있게 한다(기본 10분 유지).
-- 3) 휴면 주문서 경로(order_sheets·save_order_sheet·get_my_order_sheet·order_funds_ok) 삭제 — 팀 확정.

-- ─────────────────────────────────────────────
-- game_state: 최종 연도 + 종료 플래그
-- ─────────────────────────────────────────────
alter table game_state
  add column if not exists final_year int,
  add column if not exists is_ended boolean not null default false;

comment on column game_state.final_year is
  '대회 종료 시 최종 정산에 쓰는 연도(예: 2025). current_round가 total_rounds를 넘으면 이 연도 가격을 쓴다.';
comment on column game_state.is_ended is 'true면 대회 종료(최종 정산 완료). 학생 화면이 final_year를 공개한다.';

-- ─────────────────────────────────────────────
-- current_price: round_year_map에 현재 라운드가 없으면 final_year로 폴백.
--   정상 라운드(1~5)는 그대로. 종료 후(current_round=total_rounds+1)엔 2025 가격이 나온다.
-- ─────────────────────────────────────────────
create or replace function current_price(p_stock_id text)
returns bigint
language sql
stable
as $$
  select coalesce(
    (s.prices ->> coalesce(g.round_year_map ->> g.current_round::text, g.final_year::text))::bigint,
    0)
  from stocks s
  cross join game_state g
  where s.id = p_stock_id and g.id = 1;
$$;

-- ─────────────────────────────────────────────
-- 대회 종료 — 최종 연도(2025) 가격을 공개하고 그 시점 평가금액을 스냅샷.
--   current_round를 total_rounds+1로 올리면 current_price가 final_year로 넘어가
--   team_equity·leaderboard가 전부 2025 기준이 된다. 거래는 타이머가 없어 자동 잠김.
-- ─────────────────────────────────────────────
create or replace function admin_end_game(p_admin_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cur int;
  v_total int;
  v_final int;
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  select current_round, total_rounds, final_year into v_cur, v_total, v_final from game_state where id = 1 for update;
  if v_cur < 1 then
    return jsonb_build_object('ok', false, 'error', 'game_not_started');
  end if;

  -- 최종 연도 공개 (거래 잠금)
  update game_state
    set current_round = v_total + 1, is_ended = true, is_locked = false, round_ends_at = null
  where id = 1;

  -- 최종 평가금액 스냅샷 (이제 current_price가 final_year 가격을 준다)
  insert into round_snapshots (team_id, round, equity)
  select t.id, v_total + 1, team_equity(t.id) from teams t
  on conflict (team_id, round) do update set equity = excluded.equity;

  perform emit_signal('game_ended', jsonb_build_object('round', v_total + 1, 'final_year', v_final));
  return jsonb_build_object('ok', true, 'final_year', v_final, 'round', v_total + 1);
end;
$$;

grant execute on function admin_end_game(text) to anon, authenticated;

-- ─────────────────────────────────────────────
-- 타이머 시작 — 분 단위 지정 가능. 옛 (text) 시그니처는 오버로드 방지를 위해 drop.
-- ─────────────────────────────────────────────
drop function if exists start_round_timer(text);

create or replace function start_round_timer(p_admin_secret text, p_minutes int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round int;
  v_dur int;
  v_ends timestamptz;
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  select current_round, round_duration_seconds into v_round, v_dur from game_state where id = 1 for update;
  if v_round is null or v_round < 1 then
    return jsonb_build_object('ok', false, 'error', 'game_not_started');
  end if;

  -- 분을 지정하면 기본 길이도 그 값으로 갱신(다음 라운드에도 유지)
  if p_minutes is not null and p_minutes > 0 then
    v_dur := p_minutes * 60;
    update game_state set round_duration_seconds = v_dur where id = 1;
  end if;

  v_ends := now() + make_interval(secs => coalesce(v_dur, 600));
  update game_state set round_ends_at = v_ends, is_locked = false where id = 1;

  perform emit_signal('timer_started', jsonb_build_object('round', v_round, 'ends_at', v_ends));
  return jsonb_build_object('ok', true, 'round', v_round, 'ends_at', v_ends, 'seconds', coalesce(v_dur, 600));
end;
$$;

grant execute on function start_round_timer(text, int) to anon, authenticated;

-- ─────────────────────────────────────────────
-- 게임 리셋 — order_sheets 삭제 제거, is_ended 초기화
-- ─────────────────────────────────────────────
create or replace function reset_game(p_admin_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  update game_state set is_locked = true where id = 1;

  delete from round_snapshots where true;
  delete from trades where true;
  delete from positions where true;
  delete from hint_grants where true;
  delete from broadcasts where true;
  update teams set cash = seed where true;

  update game_state
    set current_round = 0, is_locked = false, is_ended = false, round_ends_at = null
  where id = 1;

  perform emit_signal('game_reset', '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function reset_game(text) to anon, authenticated;

-- ─────────────────────────────────────────────
-- 휴면 주문서 경로 삭제 (즉시 체결 확정)
-- ─────────────────────────────────────────────
drop function if exists save_order_sheet(text, jsonb);
drop function if exists get_my_order_sheet(text);
drop function if exists order_funds_ok(bigint, bigint, bigint);
drop table if exists order_sheets;
