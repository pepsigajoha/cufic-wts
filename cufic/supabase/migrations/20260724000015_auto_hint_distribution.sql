-- 힌트 자동 차등 지급 — 라운드 전환 시(R2부터) 순위 기준 자동 배분.
--
-- 규칙 (매핑은 [잠정] — 팀 컨펌 대기):
--   * R1은 지급 없음. R2부터 [연도 넘기기]가 자동 배분한다. 강사 수동 지급은 보조로 유지.
--   * 하위권 우대: 꼴찌 = S(최상위 힌트).
--   * 등급구간 = floor((순위-1) ÷ 조수 × 5), 상위부터 D→S. 동률은 같은 순위(=같은 등급).
--     8조 예: 1~2위 D, 3~4위 C, 5위 B, 6~7위 A, 8위 S.
--   * 힌트 풀: 라운드당 등급별 1개(같은 등급 조는 같은 힌트). 그 등급이 없으면 인접 등급 대체 + 관리자 경고.
--
-- 순위 기준: **새 연도 가격이 공개된 직후의 평가금액 순위**(leaderboard와 동일).
--   R1은 전 조가 같은 가격에 사서 평가금액이 시드로 전부 동률이라, 가격이 갈린 뒤라야 차등이 난다.
--   → advance_round가 current_round를 올린 뒤(=새 가격 반영 후) 이 함수를 호출한다.

-- ─────────────────────────────────────────────
-- 한 라운드분 자동 배분. 내부 전용(anon revoke). advance_round가 호출한다.
-- 현재 game_state.current_round 가격 기준 순위로, p_hint_round 힌트를 지급.
-- ─────────────────────────────────────────────
create or replace function distribute_round_hints(p_hint_round int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nteams int;
  v_granted int := 0;
  v_warn jsonb := '[]'::jsonb;
begin
  select count(*) into v_nteams from teams;
  if v_nteams = 0 then
    return jsonb_build_object('granted', 0, 'warnings', v_warn);
  end if;

  -- 팀별 등급 인덱스(D=0..S=4) → p_hint_round 힌트 중 가장 가까운 등급을 지급.
  -- rank()라 동률은 같은 순위 → 같은 등급.
  with ranked as (
    select t.id as team_id,
           least(greatest(
             floor((rank() over (order by team_equity(t.id) desc) - 1)::numeric / v_nteams * 5)::int,
           0), 4) as gi
    from teams t
  ),
  pool as (
    select h.id,
           (case h.grade when 'D' then 0 when 'C' then 1 when 'B' then 2 when 'A' then 3 when 'S' then 4 end) as gi
    from hints h
    where h.round = p_hint_round
  ),
  resolved as (
    select r.team_id,
           (select p.id from pool p order by abs(p.gi - r.gi), p.gi limit 1) as hint_id
    from ranked r
  )
  insert into hint_grants (hint_id, team_id)
  select hint_id, team_id from resolved where hint_id is not null
  on conflict (hint_id, team_id) do nothing;
  get diagnostics v_granted = row_count;

  -- 경고: 필요한 등급인데 그 라운드에 '정확히 그 등급' 힌트가 없는 경우(인접 대체됐거나 아예 없음)
  select coalesce(jsonb_agg(jsonb_build_object(
           'grade', (array['D','C','B','A','S'])[need.gi + 1],
           'reason', case when exists (select 1 from hints where round = p_hint_round)
                          then 'adjacent_substitute' else 'no_hint_for_round' end)), '[]'::jsonb)
    into v_warn
  from (
    select distinct least(greatest(
             floor((rank() over (order by team_equity(t.id) desc) - 1)::numeric / v_nteams * 5)::int, 0), 4) as gi
    from teams t
  ) need
  where not exists (
    select 1 from hints h
    where h.round = p_hint_round
      and (case h.grade when 'D' then 0 when 'C' then 1 when 'B' then 2 when 'A' then 3 when 'S' then 4 end) = need.gi
  );

  return jsonb_build_object('granted', v_granted, 'warnings', v_warn);
end;
$$;

revoke all on function distribute_round_hints(int) from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- advance_round — 라운드 진행 로직은 그대로. 새 가격 공개 뒤 자동 힌트 배분만 추가.
--   순서: 스냅샷(떠나는 라운드) → 새 라운드로 증가(가격 공개) → 자동 배분 → 신호.
-- ─────────────────────────────────────────────
create or replace function advance_round(p_admin_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cur int;
  v_total int;
  v_dist jsonb := jsonb_build_object('granted', 0, 'warnings', '[]'::jsonb);
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  select current_round, total_rounds into v_cur, v_total from game_state where id = 1 for update;

  if v_cur >= v_total then
    return jsonb_build_object('ok', false, 'error', 'already_last_round');
  end if;

  -- 시작 전(0) → R1 열기. R1은 힌트 지급 없음.
  if v_cur < 1 then
    update game_state set current_round = 1, round_ends_at = null, is_locked = false where id = 1;
    perform emit_signal('round_advanced', jsonb_build_object('round', 1));
    return jsonb_build_object('ok', true, 'current_round', 1, 'hints', v_dist);
  end if;

  -- 떠나는 라운드 평가금액 스냅샷 (순위 등락·수익률 차트)
  insert into round_snapshots (team_id, round, equity)
  select t.id, v_cur, team_equity(t.id) from teams t
  on conflict (team_id, round) do update set equity = excluded.equity;

  -- 새 연도 공개 + 타이머 초기화
  update game_state set current_round = v_cur + 1, round_ends_at = null, is_locked = false where id = 1;

  -- 자동 힌트 배분: 새 라운드(v_cur+1)의 힌트를, 방금 공개된 가격 기준 순위로 (하위권=S)
  v_dist := distribute_round_hints(v_cur + 1);

  perform emit_signal('round_advanced', jsonb_build_object('round', v_cur + 1));
  if (v_dist ->> 'granted')::int > 0 then
    perform emit_signal('hints_changed', jsonb_build_object('auto', true, 'round', v_cur + 1));
  end if;

  return jsonb_build_object('ok', true, 'current_round', v_cur + 1, 'hints', v_dist);
end;
$$;

grant execute on function advance_round(text) to anon, authenticated;
