-- admin_end_game: 떠나는 라운드도 스냅샷한다.
--
-- 문제: 기존 admin_end_game은 final_year(2025) 스냅샷만 남겨, R5(2024) 평가금액이 기록되지 않았다.
--       그래서 수익률 차트·체결 기록에서 마지막 라운드 해가 빠지고, R4→최종이 한 칸에 뭉쳤다.
-- 해결: advance_round처럼 먼저 '떠나는 라운드(현재 가격)'를 스냅샷한 뒤, 최종 연도를 공개하고
--       최종 스냅샷을 남긴다. 두 지점(R5·2024, 최종·2025)이 모두 남는다.

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

  -- 1) 떠나는 라운드(현재 가격) 스냅샷 — 차트에 이 해가 빠지지 않게
  insert into round_snapshots (team_id, round, equity)
  select t.id, v_cur, team_equity(t.id) from teams t
  on conflict (team_id, round) do update set equity = excluded.equity;

  -- 2) 최종 연도 공개 (거래 잠금)
  update game_state
    set current_round = v_total + 1, is_ended = true, is_locked = false, round_ends_at = null
  where id = 1;

  -- 3) 최종 평가금액 스냅샷 (이제 current_price가 final_year 가격을 준다)
  insert into round_snapshots (team_id, round, equity)
  select t.id, v_total + 1, team_equity(t.id) from teams t
  on conflict (team_id, round) do update set equity = excluded.equity;

  perform emit_signal('game_ended', jsonb_build_object('round', v_total + 1, 'final_year', v_final));
  return jsonb_build_object('ok', true, 'final_year', v_final, 'round', v_total + 1);
end;
$$;

grant execute on function admin_end_game(text) to anon, authenticated;
