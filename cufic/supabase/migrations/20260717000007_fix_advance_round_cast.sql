-- advance_round 수정: order_funds_ok 호출 시 타입 불일치
--
-- 증상: advance_round가 42883 "function order_funds_ok(bigint, numeric, numeric) does not exist"로 실패.
-- 원인: Postgres의 sum()은 인자가 bigint여도 numeric을 돌려준다. 오버플로 방지 때문.
--       order_funds_ok는 (bigint, bigint, bigint)로 선언돼 있어 매칭에 실패했다.
-- 해결: 합계를 명시적으로 bigint로 캐스팅한다. 금액은 원 단위 정수라는 원칙과도 맞다.

create or replace function advance_round()
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
  select current_round, total_rounds into v_cur, v_total from game_state where id = 1 for update;

  if v_cur >= v_total then
    return jsonb_build_object('ok', false, 'error', 'already_last_round');
  end if;

  -- 시작 전(0)이면 체결할 주문서가 없다. R1을 열기만 한다.
  if v_cur < 1 then
    update game_state set current_round = 1 where id = 1;
    return jsonb_build_object('ok', true, 'current_round', 1, 'fills', 0);
  end if;

  update game_state set is_locked = true where id = 1;

  -- 안전망: 주문서는 저장 시점에 검증됐지만, 그 뒤 관리자가 가격을 고쳤다면
  -- 자금이 모자랄 수 있다. 그런 조는 매수를 통째로 건너뛰고 기록에 남긴다
  -- (매도는 현금이 늘기만 하므로 그대로 체결한다).
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

  -- ── 매도 먼저 (매도 대금을 매수 자금으로 인정하는 규칙과 일관)
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

  -- ── 그다음 매수
  for r in
    select os.team_id, os.stock_id, os.buy_qty, current_price(os.stock_id) as price
    from order_sheets os
    where os.round = v_cur and os.buy_qty > 0
    order by os.team_id, os.stock_id
  loop
    if r.price <= 0 then
      continue;
    end if;
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

  -- 스냅샷: 체결은 반영됐고 current_round는 아직 안 바뀌었으므로
  -- team_equity()가 '이번 라운드 가격'으로 계산한다 = 정산 시점 자산
  insert into round_snapshots (team_id, round, equity)
  select t.id, v_cur, team_equity(t.id) from teams t
  on conflict (team_id, round) do update set equity = excluded.equity;

  update game_state set current_round = v_cur + 1, is_locked = false where id = 1;

  return jsonb_build_object('ok', true, 'current_round', v_cur + 1,
                            'fills', v_fills, 'skipped', v_skipped);
end;
$$;

grant execute on function advance_round() to anon, authenticated;
