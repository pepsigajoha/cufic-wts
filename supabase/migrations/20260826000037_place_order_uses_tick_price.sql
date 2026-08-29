-- 실시간 체결가 함수 (2/2) — place_order가 라운드 고정가 대신 tick_price로 체결하도록 전환.
--
-- ⚠ 이 마이그레이션은 push 전에 반드시 scripts/verify-tick-price-parity.mjs로
-- private.tick_price가 src/realtimeTick.js의 tickPrice()와 같은 값을 내는지 먼저 확인할 것.
-- 어긋난 채로 체결가에 쓰면 학생이 화면에서 본 가격과 실제 체결가가 실수로 달라질 수 있다.
--
-- [범위를 의도적으로 좁힌다] 바뀌는 건 "그 순간 체결가"뿐이다:
--   - current_price(공식가)는 그대로 둔다 — team_equity(평가금액·리더보드)·차트의 라운드 구간
--     기준점(chart.js closePath)은 계속 이 값을 쓴다. 리더보드는 "연도가 넘어갈 때만 바뀐다"는
--     규칙(CLAUDE.md)은 그대로 유지된다 — 보유 포지션의 평가액이 매초 흔들리게 만들지 않는다.
--   - 오직 place_order가 그 순간 실제로 체결하는 가격(및 trades.price에 기록되는 값)만
--     tick_price로 바뀐다. 실현손익은 여전히 "판 순간의 체결가 - 평단"으로 계산되고(변경 없음),
--     이제 그 체결가 자체가 라운드 내내 고정이 아니라 초 단위로 미세하게 다르다는 점만 다르다.
--
-- 기존 place_order(20260723000013)와 비교해 바뀐 곳은 가격 계산 블록 하나뿐이다.
-- 나머지(잠금·매수/매도 분기·trades insert·반환값 shape)는 전부 동일하게 유지한다.

create or replace function place_order(
  p_team_code text,
  p_stock_id text,
  p_side text,
  p_quantity int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team teams%rowtype;
  v_pos positions%rowtype;
  v_price bigint;
  v_official_price bigint;
  v_remaining_ms double precision;
  v_amount bigint;
  v_round int;
  v_locked boolean;
  v_ends_at timestamptz;
  v_new_qty int;
  v_new_avg numeric;
  v_realized bigint;
begin
  if p_quantity is null or p_quantity <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_quantity');
  end if;
  if p_side not in ('buy', 'sell') then
    return jsonb_build_object('ok', false, 'error', 'invalid_side');
  end if;

  select current_round, is_locked, round_ends_at
    into v_round, v_locked, v_ends_at
  from game_state where id = 1;

  if v_round is null or v_round < 1 then
    return jsonb_build_object('ok', false, 'error', 'game_not_started');
  end if;
  if v_locked then
    return jsonb_build_object('ok', false, 'error', 'round_locked');
  end if;
  -- 타이머 밖 거래 차단. round_ends_at이 null이거나 이미 지났으면 거래 시간이 아니다.
  if v_ends_at is null or now() >= v_ends_at then
    return jsonb_build_object('ok', false, 'error', 'round_closed');
  end if;

  -- 동시성: 팀 행을 잠근다. 같은 조가 탭 2개에서 동시에 주문하면 두 번째는
  -- 첫 번째가 커밋될 때까지 대기했다가 갱신된 cash를 읽는다.
  select * into v_team from teams where code = p_team_code for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'team_not_found');
  end if;

  v_official_price := current_price(p_stock_id);
  if v_official_price is null or v_official_price <= 0 then
    return jsonb_build_object('ok', false, 'error', 'suspended');
  end if;

  -- [실시간 체결가] 공식가(v_official_price)를 중심으로 한 "지금 이 순간" 값을 서버가
  -- 직접 계산한다(클라이언트가 보낸 가격은 절대 신뢰하지 않는다 — 가격 조작 방지).
  -- v_ends_at은 위에서 이미 now() < v_ends_at임을 확인했으므로 남은 시간은 항상 양수다.
  v_remaining_ms := extract(epoch from (v_ends_at - now())) * 1000;
  v_price := private.tick_price(v_official_price, v_round, p_stock_id, now(), v_remaining_ms);
  v_amount := v_price * p_quantity;

  -- 보유 행도 잠근다 (같은 종목 동시 매도 대비)
  select * into v_pos from positions
  where team_id = v_team.id and stock_id = p_stock_id
  for update;

  if p_side = 'buy' then
    if v_team.cash < v_amount then
      return jsonb_build_object('ok', false, 'error', 'insufficient_cash');
    end if;

    if found then
      -- 가중평균으로 평단 재계산. round()로 프론트의 Math.round와 맞춘다.
      v_new_qty := v_pos.quantity + p_quantity;
      v_new_avg := round((v_pos.quantity * v_pos.avg_price + v_amount) / v_new_qty);
      update positions set quantity = v_new_qty, avg_price = v_new_avg
      where team_id = v_team.id and stock_id = p_stock_id;
    else
      v_new_qty := p_quantity;
      v_new_avg := v_price;
      insert into positions (team_id, stock_id, quantity, avg_price)
      values (v_team.id, p_stock_id, v_new_qty, v_new_avg);
    end if;

    update teams set cash = cash - v_amount where id = v_team.id;
    v_realized := null;

  else -- sell
    if not found or v_pos.quantity < p_quantity then
      return jsonb_build_object('ok', false, 'error', 'insufficient_shares');
    end if;

    -- 실현손익은 파는 순간의 평단으로 확정된다
    v_realized := round((v_price - v_pos.avg_price) * p_quantity);
    v_new_qty := v_pos.quantity - p_quantity;

    if v_new_qty = 0 then
      -- 전량 매도면 행을 남기지 않는다 (0수량 행이 쌓이면 보유목록이 지저분해진다)
      delete from positions where team_id = v_team.id and stock_id = p_stock_id;
      v_new_avg := 0;
    else
      -- 일부 매도는 평단을 건드리지 않는다 (남은 주식의 취득원가는 그대로)
      v_new_avg := v_pos.avg_price;
      update positions set quantity = v_new_qty
      where team_id = v_team.id and stock_id = p_stock_id;
    end if;

    update teams set cash = cash + v_amount where id = v_team.id;
  end if;

  insert into trades (team_id, stock_id, side, price, quantity, round, realized_pnl)
  values (v_team.id, p_stock_id, p_side, v_price, p_quantity, v_round, v_realized);

  select cash into v_team.cash from teams where id = v_team.id;

  return jsonb_build_object(
    'ok', true,
    'new_cash', v_team.cash,
    'new_quantity', v_new_qty,
    'new_avg_price', v_new_avg,
    'price', v_price,
    'realized_pnl', v_realized
  );
end;
$$;

grant execute on function place_order(text, text, text, int) to anon, authenticated;
