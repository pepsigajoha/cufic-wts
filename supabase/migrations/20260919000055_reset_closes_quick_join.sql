-- 새 게임은 QR 입장을 닫은 상태로 준비한다.
-- 이전 게임에서 켜둔 공개 링크가 reset 직후 새 조를 만들지 못하게 한다.

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
  delete from game_trade_logs where true;
  delete from game_team_analytics where true;
  delete from user_savings where true;
  delete from user_options_positions where true;
  delete from options_contracts where true;
  delete from structured_products where true;
  update teams set cash = seed where true;

  delete from private.config where key = 'game_pin';

  update game_state
    set current_round = 0,
        is_locked = false,
        is_ended = false,
        round_ends_at = null,
        quick_join_enabled = false
  where id = 1;

  perform emit_signal('game_reset', '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function reset_game(text) to anon, authenticated;
