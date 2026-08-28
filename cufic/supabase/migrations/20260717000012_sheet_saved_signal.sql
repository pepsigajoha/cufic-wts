-- 주문서 저장 시 신호 발행
--
-- 문제: 조가 주문서를 내도 관리자 화면의 "미제출 조" 목록이 갱신되지 않았다.
--       강사가 "다 냈나?"를 보고 라운드를 넘기는데, 낡은 화면을 보고 판단하게 된다.
-- 해결: save_order_sheet가 sheet_saved 신호를 쏜다. 관리자만 이 신호에 반응하면 된다
--       (조 본인은 저장 응답으로 이미 갱신했고, 다른 조의 제출 여부는 알 필요가 없다).

create or replace function save_order_sheet(p_team_code text, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team teams%rowtype;
  v_round int;
  v_locked boolean;
  v_line jsonb;
  v_price bigint;
  v_buy int;
  v_sell int;
  v_held int;
  v_buy_cost bigint := 0;
  v_sell_proceeds bigint := 0;
  v_saved int := 0;
begin
  select current_round, is_locked into v_round, v_locked from game_state where id = 1;
  if v_round is null or v_round < 1 then
    return jsonb_build_object('ok', false, 'error', 'game_not_started');
  end if;
  if v_locked then
    return jsonb_build_object('ok', false, 'error', 'round_locked');
  end if;

  select * into v_team from teams where code = p_team_code for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'team_not_found');
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'invalid_lines');
  end if;

  -- 1) 줄 단위 검증 + 금액 합산 (쓰기 전에 전부 확인)
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_buy := coalesce((v_line ->> 'buy_qty')::int, 0);
    v_sell := coalesce((v_line ->> 'sell_qty')::int, 0);

    if v_buy < 0 or v_sell < 0 then
      return jsonb_build_object('ok', false, 'error', 'invalid_quantity');
    end if;
    if v_buy = 0 and v_sell = 0 then
      continue;
    end if;

    if not exists (select 1 from stocks where id = v_line ->> 'stock_id') then
      return jsonb_build_object('ok', false, 'error', 'stock_not_found',
                                'stock_id', v_line ->> 'stock_id');
    end if;

    v_price := current_price(v_line ->> 'stock_id');
    if (v_price is null or v_price <= 0) then
      return jsonb_build_object('ok', false, 'error', 'suspended',
                                'stock_id', v_line ->> 'stock_id');
    end if;

    if v_sell > 0 then
      select coalesce(quantity, 0) into v_held from positions
      where team_id = v_team.id and stock_id = v_line ->> 'stock_id';
      if coalesce(v_held, 0) < v_sell then
        return jsonb_build_object('ok', false, 'error', 'insufficient_shares',
                                  'stock_id', v_line ->> 'stock_id',
                                  'held', coalesce(v_held, 0));
      end if;
    end if;

    v_buy_cost := v_buy_cost + v_buy::bigint * v_price;
    v_sell_proceeds := v_sell_proceeds + v_sell::bigint * v_price;
  end loop;

  -- 2) 자금 검증
  if not order_funds_ok(v_team.cash, v_buy_cost, v_sell_proceeds) then
    return jsonb_build_object('ok', false, 'error', 'insufficient_cash',
                              'cash', v_team.cash,
                              'buy_cost', v_buy_cost,
                              'sell_proceeds', v_sell_proceeds);
  end if;

  -- 3) 시트 통째 교체
  delete from order_sheets where team_id = v_team.id and round = v_round;

  insert into order_sheets (team_id, round, stock_id, buy_qty, sell_qty)
  select v_team.id, v_round, l ->> 'stock_id',
         coalesce((l ->> 'buy_qty')::int, 0), coalesce((l ->> 'sell_qty')::int, 0)
  from jsonb_array_elements(p_lines) l
  where coalesce((l ->> 'buy_qty')::int, 0) > 0 or coalesce((l ->> 'sell_qty')::int, 0) > 0;

  get diagnostics v_saved = row_count;

  -- 관리자가 제출 현황을 실시간으로 볼 수 있게
  perform emit_signal('sheet_saved',
    jsonb_build_object('team_code', v_team.code, 'lines', v_saved));

  return jsonb_build_object('ok', true, 'lines', v_saved,
                            'buy_cost', v_buy_cost, 'sell_proceeds', v_sell_proceeds,
                            'cash_after_fill', v_team.cash - v_buy_cost + v_sell_proceeds);
end;
$$;

grant execute on function save_order_sheet(text, jsonb) to anon, authenticated;
