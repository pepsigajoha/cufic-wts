-- reset_game 수정: WHERE 없는 DELETE/UPDATE가 거부되던 문제
--
-- 증상: reset_game이 항상 400 {"code":"21000","message":"DELETE requires a WHERE clause"}로
--       실패했다. 응답을 확인하지 않으면 조용히 아무 일도 안 일어난 것처럼 보인다.
--
-- 원인: Supabase는 PostgREST 세션에 safeupdate 가드를 걸어 WHERE 없는 DELETE/UPDATE를 막는다.
--       실수로 테이블 전체를 날리는 걸 방지하는 안전장치다.
--       security definer로 소유자 권한을 얻어도 이건 '세션 설정'이라 그대로 적용된다.
--
-- 해결: 전체를 지우려는 의도를 where true로 명시한다. 가드의 목적(실수 방지)은
--       유지되고, 의도적인 전체 삭제만 통과한다.

create or replace function reset_game()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update game_state set is_locked = true where id = 1;

  -- where true = "전체를 지우는 게 맞다"는 명시. safeupdate 가드를 통과하기 위함.
  delete from round_snapshots where true;
  delete from trades where true;
  delete from positions where true;
  update teams set cash = seed where true;
  update news set is_published = false where true;

  update game_state set current_round = 0, is_locked = false where id = 1;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function reset_game() to anon, authenticated;
