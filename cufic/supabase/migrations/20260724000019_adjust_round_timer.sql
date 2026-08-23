-- adjust_round_timer: 진행 중인 거래 타이머를 ±초 조정한다 (관리자 ±1분 버튼).
--
-- 타이머 시작은 무조건 기본 길이(10분)로 하고, 필요하면 이 함수로 라운드 도중 늘리거나 줄인다.
-- 줄일 때도 now()+10초는 남겨, 거래가 갑자기 음수 시간으로 닫히지 않게 한다.

create or replace function adjust_round_timer(p_admin_secret text, p_delta_seconds int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round int;
  v_ends timestamptz;
  v_new timestamptz;
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  select current_round, round_ends_at into v_round, v_ends from game_state where id = 1 for update;
  if v_round is null or v_round < 1 then
    return jsonb_build_object('ok', false, 'error', 'game_not_started');
  end if;
  if v_ends is null then
    return jsonb_build_object('ok', false, 'error', 'timer_not_running');
  end if;

  v_new := greatest(now() + interval '10 seconds', v_ends + make_interval(secs => p_delta_seconds));
  update game_state set round_ends_at = v_new, is_locked = false where id = 1;

  perform emit_signal('timer_started', jsonb_build_object('round', v_round, 'ends_at', v_new));
  return jsonb_build_object('ok', true, 'round', v_round, 'ends_at', v_new);
end;
$$;

grant execute on function adjust_round_timer(text, int) to anon, authenticated;
