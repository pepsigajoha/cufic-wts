-- 종가 단일가 체결 모드(0050 flat_pricing)를 라운드 진행 중에도 토글.
--
-- admin_update_game_config는 시작 전에만(game_already_started 가드) 바꿀 수 있다. 하지만
-- 강사가 R2에서 학생들이 차트 단타하는 걸 보고 R3부터 잠그고 싶을 수 있다 → 진행 중에도
-- 되는 전용 RPC를 둔다. 체결가는 exec_price가 매 주문마다 game_state.flat_pricing을 읽으므로
-- 토글 즉시 다음 주문부터 반영된다(이미 체결된 거래는 그대로).

create or replace function admin_set_flat_pricing(p_admin_secret text, p_flat_pricing boolean)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  if p_flat_pricing is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_payload');
  end if;
  update game_state set flat_pricing = p_flat_pricing where id = 1;
  -- 학생 App.jsx는 stocks_changed 신호에 refetch → game.flat_pricing 갱신 → 안내 문구 즉시 반영
  perform emit_signal('stocks_changed', jsonb_build_object('flat_pricing', p_flat_pricing));
  return jsonb_build_object('ok', true, 'flat_pricing', p_flat_pricing);
end;
$$;
grant execute on function admin_set_flat_pricing(text, boolean) to anon, authenticated;
