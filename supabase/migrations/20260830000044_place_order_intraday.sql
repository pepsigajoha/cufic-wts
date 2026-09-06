-- place_order·옵션 스팟·주가 적용 RPC를 장중 경로(exec_price) 기반으로 전환한다.
-- 벽시계 의사난수 흔들림(private.tick_price)은 더 이상 체결에 쓰지 않는다 —
-- 이제 "그 순간 가격"은 stock_price_paths의 실제 시뮬레이션 스텝 값이다(20260830000043).
-- private.tick_price 자체는 남겨 둔다(옛 마이그레이션 호환·참조용, 아무도 호출 안 함).

-- ─────────────────────────────────────────────
-- 1. start_round_timer — round_start_at을 함께 세운다(진행률 기준점).
--    0016 정의 + round_start_at 갱신 한 줄.
-- ─────────────────────────────────────────────
create or replace function start_round_timer(p_admin_secret text, p_minutes int default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round int;
  v_dur int;
  v_ends timestamptz;
  v_start timestamptz := now();
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  select current_round, round_duration_seconds into v_round, v_dur from game_state where id = 1 for update;
  if v_round is null or v_round < 1 then
    return jsonb_build_object('ok', false, 'error', 'game_not_started');
  end if;

  if p_minutes is not null and p_minutes > 0 then
    v_dur := p_minutes * 60;
    update game_state set round_duration_seconds = v_dur where id = 1;
  end if;

  v_ends := v_start + make_interval(secs => coalesce(v_dur, 600));
  -- round_start_at은 "타이머를 (다시) 연 시각"으로 매번 새로 찍는다 → 스텝이 0부터 다시 진행된다.
  update game_state set round_start_at = v_start, round_ends_at = v_ends, is_locked = false where id = 1;

  perform emit_signal('timer_started', jsonb_build_object('round', v_round, 'ends_at', v_ends));
  return jsonb_build_object('ok', true, 'round', v_round, 'ends_at', v_ends, 'seconds', coalesce(v_dur, 600));
end;
$$;
grant execute on function start_round_timer(text, int) to anon, authenticated;

-- ─────────────────────────────────────────────
-- 2. place_order — 체결가를 private.exec_price로. 나머지(잠금·분기·trades·반환 shape)는 0037과 동일.
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
  if v_ends_at is null or now() >= v_ends_at then
    return jsonb_build_object('ok', false, 'error', 'round_closed');
  end if;

  select * into v_team from teams where code = p_team_code for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'team_not_found');
  end if;

  -- [장중 체결가] 라운드 진행률에 해당하는 시뮬레이션 스텝 값. 서버가 직접 계산하고
  -- 클라이언트가 보낸 값은 절대 신뢰하지 않는다(가격 조작 방지).
  v_price := private.exec_price(p_stock_id);
  if v_price is null or v_price <= 0 then
    return jsonb_build_object('ok', false, 'error', 'suspended');
  end if;
  v_amount := v_price * p_quantity;

  select * into v_pos from positions
  where team_id = v_team.id and stock_id = p_stock_id
  for update;

  if p_side = 'buy' then
    if v_team.cash < v_amount then
      return jsonb_build_object('ok', false, 'error', 'insufficient_cash');
    end if;

    if found then
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

    v_realized := round((v_price - v_pos.avg_price) * p_quantity);
    v_new_qty := v_pos.quantity - p_quantity;

    if v_new_qty = 0 then
      delete from positions where team_id = v_team.id and stock_id = p_stock_id;
      v_new_avg := 0;
    else
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

-- ─────────────────────────────────────────────
-- 3. 옵션 스팟도 같은 장중 체결가를 쓴다 → 스팟이 앱 전체에서 한 값으로 일치(put-call parity 유지).
-- ─────────────────────────────────────────────
create or replace function private.live_tick_price(p_stock_id text)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return private.exec_price(p_stock_id);
end;
$$;

-- ─────────────────────────────────────────────
-- 4. admin_apply_simulated_prices — 경로(252)를 함께 받아 stock_price_paths에 기록하고,
--    각 경로의 마지막 값을 stocks.prices의 그 연도 값으로 동기화한다(레거시 소비자 정합성).
--    기존 스칼라 전용 호출(p_prices만)도 그대로 동작한다.
--    시그니처가 바뀌므로 옛 2-인자 버전은 drop한다(오버로드로 무방비 버전이 남지 않게).
-- ─────────────────────────────────────────────
drop function if exists admin_apply_simulated_prices(text, jsonb);

create or replace function admin_apply_simulated_prices(
  p_admin_secret text,
  p_prices jsonb default null,           -- { [stock_id]: { [year]: price } }  (스칼라, 기존 방식)
  p_paths jsonb default null,            -- { [stock_id]: number[252] }         (연도 하나의 장중 경로)
  p_year int default null                -- p_paths가 적용될 연도
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scalar_applied int := 0;
  v_path_applied int := 0;
  v_sid text;
  v_arr jsonb;
  v_nums numeric[];
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  -- (A) 스칼라 경로 — 기존 방식 유지
  if p_prices is not null and jsonb_typeof(p_prices) = 'object' and p_prices <> '{}'::jsonb then
    update stocks s set prices = p_prices -> s.id
    where s.id in (select jsonb_object_keys(p_prices));
    get diagnostics v_scalar_applied = row_count;
  end if;

  -- (B) 장중 경로 — 252개 배열을 stock_price_paths에 upsert + stocks.prices[year] = 배열 끝값
  if p_paths is not null and jsonb_typeof(p_paths) = 'object' and p_paths <> '{}'::jsonb then
    if p_year is null then
      return jsonb_build_object('ok', false, 'error', 'invalid_payload'); -- 경로엔 연도가 필요
    end if;

    for v_sid, v_arr in select * from jsonb_each(p_paths) loop
      if jsonb_typeof(v_arr) <> 'array' or jsonb_array_length(v_arr) <> 252 then
        continue; -- 형식이 안 맞는 종목은 조용히 건너뛴다(applied 건수로 불일치 감지 가능)
      end if;
      if not exists (select 1 from stocks where id = v_sid) then
        continue;
      end if;

      select array_agg((e)::numeric order by ord)
        into v_nums
      from jsonb_array_elements_text(v_arr) with ordinality as t(e, ord);

      insert into stock_price_paths (stock_id, year, prices, updated_at)
      values (v_sid, p_year, v_nums, now())
      on conflict (stock_id, year) do update set prices = excluded.prices, updated_at = now();

      -- 레거시 정합성: 연말 스칼라 = 경로의 마지막 값
      update stocks
        set prices = coalesce(prices, '{}'::jsonb) || jsonb_build_object(p_year::text, round(v_nums[252]))
      where id = v_sid;

      v_path_applied := v_path_applied + 1;
    end loop;
  end if;

  perform emit_signal('stocks_changed', jsonb_build_object('source', 'simulator', 'scalar', v_scalar_applied, 'paths', v_path_applied));
  return jsonb_build_object('ok', true, 'scalar_applied', v_scalar_applied, 'paths_applied', v_path_applied);
end;
$$;

grant execute on function admin_apply_simulated_prices(text, jsonb, jsonb, int) to anon, authenticated;

-- reset_game은 stock_price_paths를 지우지 않는다 — 종목·힌트처럼 "콘텐츠"에 해당한다
-- (게임 리셋은 조 데이터만 초기화). 데이터셋 전환 시 함께 교체하려면 별도 작업.
