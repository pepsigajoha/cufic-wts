-- §2 주문 처리 RPC — 서버가 유일한 심판
--
-- 프론트 검증은 왕복 전에 막는 UX용일 뿐이다. 학생이 개발자도구로 우회할 수 있으므로
-- 최종 판정은 전부 여기서 한다. RLS가 직접 쓰기를 막고 있어 이 함수들이 유일한 쓰기 경로다.
--
-- 계산식은 프론트 src/actions.js·account.js와 동일해야 한다:
--   평균단가   = 총 매수금액 / 총 매수수량          (매수 시 가중평균 재계산)
--   실현손익   = (체결가 - 평균단가) * 수량          (매도 시점에 확정)
--   예수금     = 원금 - 매수합 + 매도합
--   평가금액   = 예수금 + Σ(보유수량 * 현재가)

-- ─────────────────────────────────────────────
-- 현재 라운드의 종목 가격. 값이 없거나 0이면 거래정지.
-- ─────────────────────────────────────────────
create or replace function current_price(p_stock_id text)
returns bigint
language sql
stable
as $$
  select coalesce((s.prices ->> (g.round_year_map ->> g.current_round::text))::bigint, 0)
  from stocks s
  cross join game_state g
  where s.id = p_stock_id and g.id = 1;
$$;

-- ─────────────────────────────────────────────
-- 팀 평가금액 = 예수금 + Σ(보유수량 * 현재가)
-- ─────────────────────────────────────────────
create or replace function team_equity(p_team_id uuid)
returns bigint
language sql
stable
as $$
  select t.cash + coalesce((
    select sum(p.quantity::bigint * current_price(p.stock_id))
    from positions p
    where p.team_id = t.id
  ), 0)
  from teams t
  where t.id = p_team_id;
$$;

-- ─────────────────────────────────────────────
-- 주문 체결
-- ─────────────────────────────────────────────
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
  v_amount bigint;
  v_round int;
  v_locked boolean;
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

  select current_round, is_locked into v_round, v_locked from game_state where id = 1;
  if v_locked then
    return jsonb_build_object('ok', false, 'error', 'round_locked');
  end if;
  if v_round is null or v_round < 1 then
    return jsonb_build_object('ok', false, 'error', 'game_not_started');
  end if;

  -- 여기가 동시성의 핵심.
  -- for update로 팀 행을 잠근다. 같은 조가 탭 2개에서 동시에 주문하면 두 번째는
  -- 첫 번째가 커밋될 때까지 대기했다가 '갱신된' cash를 읽는다.
  -- 이게 없으면 둘 다 옛 cash를 읽고 둘 다 통과해 잔고가 음수로 내려간다.
  select * into v_team from teams where code = p_team_code for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'team_not_found');
  end if;

  v_price := current_price(p_stock_id);
  if v_price is null or v_price <= 0 then
    return jsonb_build_object('ok', false, 'error', 'suspended');
  end if;
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
      -- 전량 매도면 행을 남기지 않는다. 0수량 행이 쌓이면 보유종목 목록이 지저분해진다.
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

-- ─────────────────────────────────────────────
-- 라운드 진행 (관리자)
-- ─────────────────────────────────────────────
create or replace function advance_round()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cur int;
  v_total int;
begin
  select current_round, total_rounds into v_cur, v_total from game_state where id = 1 for update;

  if v_cur >= v_total then
    return jsonb_build_object('ok', false, 'error', 'already_last_round');
  end if;

  -- 정산 중 주문 차단
  update game_state set is_locked = true where id = 1;

  -- 떠나는 라운드의 평가금액을 전 팀 기록. 아직 current_round가 안 바뀌었으므로
  -- team_equity()는 '이번 라운드 종료 시점' 가격으로 계산한다.
  if v_cur >= 1 then
    insert into round_snapshots (team_id, round, equity)
    select t.id, v_cur, team_equity(t.id) from teams t
    on conflict (team_id, round) do update set equity = excluded.equity;
  end if;

  update game_state set current_round = v_cur + 1, is_locked = false where id = 1;

  return jsonb_build_object('ok', true, 'current_round', v_cur + 1);
end;
$$;

-- ─────────────────────────────────────────────
-- 게임 초기화 (관리자) — 조는 남기고 거래만 지운다
-- ─────────────────────────────────────────────
create or replace function reset_game()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update game_state set is_locked = true where id = 1;

  delete from round_snapshots;
  delete from trades;
  delete from positions;
  update teams set cash = seed;
  update news set is_published = false;

  update game_state set current_round = 0, is_locked = false where id = 1;

  return jsonb_build_object('ok', true);
end;
$$;

-- ─────────────────────────────────────────────
-- 실행 권한 — anon이 호출할 수 있어야 한다.
-- 관리자 전용 함수(advance_round·reset_game)는 §4에서 비밀번호 검증을 얹는다.
-- ─────────────────────────────────────────────
grant execute on function current_price(text) to anon, authenticated;
grant execute on function team_equity(uuid) to anon, authenticated;
grant execute on function place_order(text, text, text, int) to anon, authenticated;
grant execute on function advance_round() to anon, authenticated;
grant execute on function reset_game() to anon, authenticated;
