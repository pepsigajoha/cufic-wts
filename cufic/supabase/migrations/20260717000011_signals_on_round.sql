-- advance_round / reset_game이 신호를 발행하도록.
-- 이게 없으면 강사가 라운드를 넘겨도 학생 화면이 모른다.

create or replace function advance_round(p_admin_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cur int;
  v_total int;
  r record;
  v_pos positions%rowtype;
  v_amount bigint;
  v_new_qty int;
  v_new_avg numeric;
  v_realized bigint;
  v_fills int := 0;
  v_skipped jsonb := '[]'::jsonb;
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  select current_round, total_rounds into v_cur, v_total from game_state where id = 1 for update;

  if v_cur >= v_total then
    return jsonb_build_object('ok', false, 'error', 'already_last_round');
  end if;

  -- 시작 전(0)이면 체결할 주문서가 없다. R1을 열기만 한다.
  if v_cur < 1 then
    update game_state set current_round = 1 where id = 1;
    perform emit_signal('round_advanced', jsonb_build_object('round', 1, 'fills', 0));
    return jsonb_build_object('ok', true, 'current_round', 1, 'fills', 0);
  end if;

  update game_state set is_locked = true where id = 1;

  -- 안전망: 저장 이후 가격이 바뀌어 자금이 모자란 조는 매수를 통째로 건너뛴다
  for r in
    select t.id as team_id, t.code, t.cash,
           coalesce(sum(os.buy_qty::bigint * current_price(os.stock_id)), 0)::bigint as buy_cost,
           coalesce(sum(os.sell_qty::bigint * current_price(os.stock_id)), 0)::bigint as sell_proceeds
    from teams t
    join order_sheets os on os.team_id = t.id and os.round = v_cur
    group by t.id, t.code, t.cash
  loop
    if not order_funds_ok(r.cash, r.buy_cost, r.sell_proceeds) then
      delete from order_sheets where team_id = r.team_id and round = v_cur and buy_qty > 0;
      v_skipped := v_skipped || jsonb_build_object('team_code', r.code, 'reason', 'insufficient_cash');
    end if;
  end loop;

  -- 매도 먼저
  for r in
    select os.team_id, os.stock_id, os.sell_qty, current_price(os.stock_id) as price
    from order_sheets os
    where os.round = v_cur and os.sell_qty > 0
    order by os.team_id, os.stock_id
  loop
    select * into v_pos from positions
    where team_id = r.team_id and stock_id = r.stock_id for update;
    if not found or v_pos.quantity < r.sell_qty or r.price <= 0 then
      continue;
    end if;

    v_amount := r.price * r.sell_qty;
    v_realized := round((r.price - v_pos.avg_price) * r.sell_qty);
    v_new_qty := v_pos.quantity - r.sell_qty;

    if v_new_qty = 0 then
      delete from positions where team_id = r.team_id and stock_id = r.stock_id;
    else
      update positions set quantity = v_new_qty
      where team_id = r.team_id and stock_id = r.stock_id;
    end if;

    update teams set cash = cash + v_amount where id = r.team_id;
    insert into trades (team_id, stock_id, side, price, quantity, round, realized_pnl)
    values (r.team_id, r.stock_id, 'sell', r.price, r.sell_qty, v_cur, v_realized);
    v_fills := v_fills + 1;
  end loop;

  -- 그다음 매수
  for r in
    select os.team_id, os.stock_id, os.buy_qty, current_price(os.stock_id) as price
    from order_sheets os
    where os.round = v_cur and os.buy_qty > 0
    order by os.team_id, os.stock_id
  loop
    if r.price <= 0 then continue; end if;
    v_amount := r.price * r.buy_qty;

    select * into v_pos from positions
    where team_id = r.team_id and stock_id = r.stock_id for update;

    if found then
      v_new_qty := v_pos.quantity + r.buy_qty;
      v_new_avg := round((v_pos.quantity * v_pos.avg_price + v_amount) / v_new_qty);
      update positions set quantity = v_new_qty, avg_price = v_new_avg
      where team_id = r.team_id and stock_id = r.stock_id;
    else
      insert into positions (team_id, stock_id, quantity, avg_price)
      values (r.team_id, r.stock_id, r.buy_qty, r.price);
    end if;

    update teams set cash = cash - v_amount where id = r.team_id;
    insert into trades (team_id, stock_id, side, price, quantity, round, realized_pnl)
    values (r.team_id, r.stock_id, 'buy', r.price, r.buy_qty, v_cur, null);
    v_fills := v_fills + 1;
  end loop;

  delete from order_sheets where round = v_cur;

  -- 스냅샷: 체결 반영 후 · 새 가격 적용 전
  insert into round_snapshots (team_id, round, equity)
  select t.id, v_cur, team_equity(t.id) from teams t
  on conflict (team_id, round) do update set equity = excluded.equity;

  update game_state set current_round = v_cur + 1, is_locked = false where id = 1;

  perform emit_signal('round_advanced',
    jsonb_build_object('round', v_cur + 1, 'fills', v_fills, 'skipped', v_skipped));

  return jsonb_build_object('ok', true, 'current_round', v_cur + 1,
                            'fills', v_fills, 'skipped', v_skipped);
end;
$$;

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
  delete from order_sheets where true;
  delete from hint_grants where true;
  update teams set cash = seed where true;

  update game_state set current_round = 0, is_locked = false where id = 1;

  perform emit_signal('game_reset', '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function advance_round(text) to anon, authenticated;
grant execute on function reset_game(text) to anon, authenticated;
