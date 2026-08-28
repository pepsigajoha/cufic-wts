-- 게임 리셋 시 공용 게임 PIN도 초기화한다.
--
-- 그동안 reset_game은 private.config('game_pin')를 안 건드려서, 리셋·라운드 넘김·조 삭제로도
-- 이전에 발급된 PIN이 그대로 남았다. "발급 안 눌렀는데 PIN이 있다"는 혼란의 원인.
-- 리셋 = 새 판 시작이므로 PIN도 지워, 강사가 매번 [PIN 발급]으로 새로 만들게 한다
-- (이전 세션 PIN 잔존 방지 = 더 안전). 같은 기기 학생은 localStorage 코드로 재접속하므로 영향 없음.
--
-- reset_game 최신 정의(0016)에 `delete from private.config where key='game_pin'` 한 줄만 추가.

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

  delete from private.config where key = 'game_pin'; -- 공용 게임 PIN 초기화 (리셋 = 새 판)

  update game_state
    set current_round = 0, is_locked = false, is_ended = false, round_ends_at = null
  where id = 1;

  perform emit_signal('game_reset', '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function reset_game(text) to anon, authenticated;
