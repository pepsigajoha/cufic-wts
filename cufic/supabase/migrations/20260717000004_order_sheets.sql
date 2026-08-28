-- 즉시 체결 → 주문서 일괄 체결로 전환
--
-- 규칙: 조는 라운드 중 종목별 매수량/매도량을 담은 주문서를 쓰고 언제든 고칠 수 있다.
--       관리자가 라운드를 넘기면 전 조 주문서가 '그 라운드 가격'으로 일괄 체결되고,
--       그다음 다음 연도 가격이 공개된다. 즉시 체결(place_order)은 폐기한다.

drop function if exists place_order(text, text, text, int);

-- ─────────────────────────────────────────────
-- 주문서 — (조, 라운드, 종목)당 한 줄
-- ─────────────────────────────────────────────
create table order_sheets (
  team_id uuid references teams(id) on delete cascade,
  round int not null,
  stock_id text references stocks(id) on delete cascade,
  buy_qty int not null default 0 check (buy_qty >= 0),
  sell_qty int not null default 0 check (sell_qty >= 0),
  updated_at timestamptz default now(),
  primary key (team_id, round, stock_id)
);

comment on table order_sheets is
  '라운드 중 수정 가능. advance_round가 일괄 체결한 뒤 비운다.';

alter table order_sheets enable row level security;
-- select 정책 없음 = REST로 못 읽는다.
-- 인증이 없어(anon key + 참가 코드) RLS가 "자기 조"를 알 방법이 없으므로,
-- 읽기는 코드를 받는 RPC(get_my_order_sheet)로만 연다. 쓰기도 RPC뿐이다.

-- ─────────────────────────────────────────────
-- 자금 규칙 — 바꾸기 쉽게 따로 뺀다
-- ─────────────────────────────────────────────
create or replace function order_funds_ok(
  p_cash bigint,
  p_buy_cost bigint,
  p_sell_proceeds bigint
)
returns boolean
language sql
immutable
as $$
  -- ⚠ 잠정 규칙 (팀 확인 중)
  -- 같은 주문서의 매도 대금을 매수 자금으로 인정한다. 작년 시트 수식을 계승한 것.
  -- 인정하지 않는 규칙으로 바뀌면 아래 한 줄만 고치면 된다:
  --   select p_cash >= p_buy_cost;
  select p_cash - p_buy_cost + p_sell_proceeds >= 0;
$$;

-- ─────────────────────────────────────────────
-- 주문서 저장 (조 전용) — 시트 전체를 통째로 갈아끼운다
--   p_lines: [{"stock_id":"005930","buy_qty":10,"sell_qty":0}, ...]
-- ─────────────────────────────────────────────
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
  -- 정산 중에는 주문서를 못 고친다. advance_round가 읽는 도중에 바뀌면 안 된다.
  if v_locked then
    return jsonb_build_object('ok', false, 'error', 'round_locked');
  end if;

  -- 같은 조가 동시에 저장해도 순서가 지켜지도록 팀 행을 잠근다
  select * into v_team from teams where code = p_team_code for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'team_not_found');
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'invalid_lines');
  end if;

  -- 1) 줄 단위 검증 + 금액 합산 (쓰기 전에 전부 확인한다)
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_buy := coalesce((v_line ->> 'buy_qty')::int, 0);
    v_sell := coalesce((v_line ->> 'sell_qty')::int, 0);

    if v_buy < 0 or v_sell < 0 then
      return jsonb_build_object('ok', false, 'error', 'invalid_quantity');
    end if;
    if v_buy = 0 and v_sell = 0 then
      continue; -- 빈 줄은 저장하지 않는다
    end if;

    if not exists (select 1 from stocks where id = v_line ->> 'stock_id') then
      return jsonb_build_object('ok', false, 'error', 'stock_not_found',
                                'stock_id', v_line ->> 'stock_id');
    end if;

    v_price := current_price(v_line ->> 'stock_id');
    -- 거래정지 종목은 사지도 팔지도 못한다
    if (v_price is null or v_price <= 0) and (v_buy > 0 or v_sell > 0) then
      return jsonb_build_object('ok', false, 'error', 'suspended',
                                'stock_id', v_line ->> 'stock_id');
    end if;

    if v_sell > 0 then
      select coalesce(quantity, 0) into v_held from positions
      where team_id = v_team.id and stock_id = v_line ->> 'stock_id';
      -- 공매도 불가
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

  -- 3) 통과했으니 시트를 통째로 교체
  delete from order_sheets where team_id = v_team.id and round = v_round;

  insert into order_sheets (team_id, round, stock_id, buy_qty, sell_qty)
  select v_team.id, v_round, l ->> 'stock_id',
         coalesce((l ->> 'buy_qty')::int, 0), coalesce((l ->> 'sell_qty')::int, 0)
  from jsonb_array_elements(p_lines) l
  where coalesce((l ->> 'buy_qty')::int, 0) > 0 or coalesce((l ->> 'sell_qty')::int, 0) > 0;

  get diagnostics v_saved = row_count;

  return jsonb_build_object('ok', true, 'lines', v_saved,
                            'buy_cost', v_buy_cost, 'sell_proceeds', v_sell_proceeds,
                            'cash_after_fill', v_team.cash - v_buy_cost + v_sell_proceeds);
end;
$$;

-- ─────────────────────────────────────────────
-- 주문서 읽기 (조 전용). RLS로 조를 구분할 수 없어 RPC로 연다.
-- ─────────────────────────────────────────────
create or replace function get_my_order_sheet(p_team_code text)
returns table (stock_id text, buy_qty int, sell_qty int)
language sql
security definer
set search_path = public
as $$
  select os.stock_id, os.buy_qty, os.sell_qty
  from order_sheets os
  join teams t on t.id = os.team_id
  cross join game_state g
  where t.code = p_team_code and os.round = g.current_round and g.id = 1
  order by os.stock_id;
$$;

-- ─────────────────────────────────────────────
-- 라운드 진행 — 일괄 체결. 전체가 하나의 트랜잭션이다.
--   1) 잠금  2) 매도 먼저 → 매수  3) 주문서 비움
--   4) 스냅샷(체결 반영 후·새 가격 적용 전)  5) 라운드+1  6) 잠금 해제
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
           coalesce(sum(os.buy_qty::bigint * current_price(os.stock_id)), 0) as buy_cost,
           coalesce(sum(os.sell_qty::bigint * current_price(os.stock_id)), 0) as sell_proceeds
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
    -- 보유가 사라졌으면 조용히 건너뛴다 (정상 흐름에선 일어나지 않는다)
    if not found or v_pos.quantity < r.sell_qty or r.price <= 0 then
      continue;
    end if;

    v_amount := r.price * r.sell_qty;
    v_realized := round((r.price - v_pos.avg_price) * r.sell_qty);
    v_new_qty := v_pos.quantity - r.sell_qty;

    if v_new_qty = 0 then
      -- 전량 매도면 행을 남기지 않는다
      delete from positions where team_id = r.team_id and stock_id = r.stock_id;
    else
      -- 일부 매도는 평단을 건드리지 않는다
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
      -- 가중평균으로 평단 재계산
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

  -- ── 주문서 비움
  delete from order_sheets where round = v_cur;

  -- ── 스냅샷: 체결은 반영됐고 current_round는 아직 안 바뀌었으므로
  --    team_equity()가 '이번 라운드 가격'으로 계산한다 = 정산 시점 자산
  insert into round_snapshots (team_id, round, equity)
  select t.id, v_cur, team_equity(t.id) from teams t
  on conflict (team_id, round) do update set equity = excluded.equity;

  update game_state set current_round = v_cur + 1, is_locked = false where id = 1;

  return jsonb_build_object('ok', true, 'current_round', v_cur + 1,
                            'fills', v_fills, 'skipped', v_skipped);
end;
$$;

grant execute on function order_funds_ok(bigint, bigint, bigint) to anon, authenticated;
grant execute on function save_order_sheet(text, jsonb) to anon, authenticated;
grant execute on function get_my_order_sheet(text) to anon, authenticated;
grant execute on function advance_round() to anon, authenticated;
