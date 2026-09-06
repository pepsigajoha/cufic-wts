-- 거래 타이머 일시정지 / 재개.
--
-- 잠깐 멈춰야 할 때(공지·질문·기술 문제) 카운트다운과 장중 스텝 진행을 함께 얼린다.
-- 재개하면 멈춘 만큼 round_ends_at·round_start_at을 뒤로 밀어 남은 시간·진행률이 그대로 이어진다.
--   · 일시정지 중: round_step_idx()가 round_paused_at 시각에서 얼고, place_order는 round_paused로 거부.
--   · is_locked(연도 넘기기 잠금)와는 별개 상태다 — 둘을 섞지 않는다.

alter table game_state add column if not exists round_paused_at timestamptz;
comment on column game_state.round_paused_at is
  '거래 타이머 일시정지 시각. null이 아니면 카운트다운·round_step_idx()가 이 시각에서 얼어 있고 place_order는 round_paused로 거부. resume_round_timer가 멈춘 만큼 시작·마감 시각을 밀고 null로 지운다.';

-- ─────────────────────────────────────────────
-- 1. 일시정지
-- ─────────────────────────────────────────────
create or replace function pause_round_timer(p_admin_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round int;
  v_ends timestamptz;
  v_paused timestamptz;
  v_locked boolean;
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  select current_round, round_ends_at, round_paused_at, is_locked
    into v_round, v_ends, v_paused, v_locked
  from game_state where id = 1 for update;

  if v_round is null or v_round < 1 then
    return jsonb_build_object('ok', false, 'error', 'game_not_started');
  end if;
  if v_ends is null then
    return jsonb_build_object('ok', false, 'error', 'timer_not_running');
  end if;
  if v_paused is not null then
    return jsonb_build_object('ok', true, 'already_paused', true); -- 멱등
  end if;
  if v_locked or now() >= v_ends then
    return jsonb_build_object('ok', false, 'error', 'round_closed');
  end if;

  update game_state set round_paused_at = now() where id = 1;
  perform emit_signal('timer_paused', jsonb_build_object('round', v_round));
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function pause_round_timer(text) to anon, authenticated;

-- ─────────────────────────────────────────────
-- 2. 재개 — 멈춘 시간(now - paused)만큼 시작·마감 시각을 뒤로 민다
-- ─────────────────────────────────────────────
create or replace function resume_round_timer(p_admin_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round int;
  v_ends timestamptz;
  v_paused timestamptz;
  v_delta interval;
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  select current_round, round_ends_at, round_paused_at
    into v_round, v_ends, v_paused
  from game_state where id = 1 for update;

  if v_round is null or v_round < 1 then
    return jsonb_build_object('ok', false, 'error', 'game_not_started');
  end if;
  if v_paused is null then
    return jsonb_build_object('ok', false, 'error', 'not_paused');
  end if;

  v_delta := now() - v_paused;
  update game_state set
    round_start_at = round_start_at + v_delta, -- null이면 null(무해 — round_step_idx가 null 처리)
    round_ends_at  = round_ends_at + v_delta,
    round_paused_at = null,
    is_locked = false
  where id = 1;

  perform emit_signal('timer_started',
    jsonb_build_object('round', v_round, 'ends_at', v_ends + v_delta, 'resumed', true));
  return jsonb_build_object('ok', true, 'ends_at', v_ends + v_delta);
end;
$$;
grant execute on function resume_round_timer(text) to anon, authenticated;

-- ─────────────────────────────────────────────
-- 3. round_step_idx() — 일시정지 시각에서 진행률을 얼린다 (0043 정의 + round_paused_at 반영)
--    src/chart.js roundStepIndex()와 공식이 일치해야 한다 (scripts/verify-intraday-step-parity.mjs).
-- ─────────────────────────────────────────────
create or replace function private.round_step_idx()
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_ends  timestamptz;
  v_locked boolean;
  v_paused timestamptz;
  v_now double precision;
  v_span double precision;
  v_frac double precision;
begin
  select round_start_at, round_ends_at, is_locked, round_paused_at
    into v_start, v_ends, v_locked, v_paused
  from game_state where id = 1;

  if v_start is null or v_ends is null or v_locked then
    return 251;
  end if;

  v_span := extract(epoch from (v_ends - v_start));
  if v_span <= 0 then
    return 251;
  end if;

  -- 일시정지 중이면 그 시각에서 진행률을 얼린다
  v_now := extract(epoch from coalesce(v_paused, now()));
  v_frac := (v_now - extract(epoch from v_start)) / v_span;
  return least(251, greatest(0, floor(v_frac * 252)::int));
end;
$$;
grant execute on function private.round_step_idx() to anon, authenticated;

-- ─────────────────────────────────────────────
-- 4. place_order — 일시정지 중 거래 거부 (0044 정의 + round_paused_at 조회·가드 한 줄)
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
  v_paused_at timestamptz;
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

  select current_round, is_locked, round_ends_at, round_paused_at
    into v_round, v_locked, v_ends_at, v_paused_at
  from game_state where id = 1;

  if v_round is null or v_round < 1 then
    return jsonb_build_object('ok', false, 'error', 'game_not_started');
  end if;
  if v_locked then
    return jsonb_build_object('ok', false, 'error', 'round_locked');
  end if;
  if v_paused_at is not null then
    return jsonb_build_object('ok', false, 'error', 'round_paused');
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

-- reset_game / start_round_timer이 round_paused_at을 지우도록 — start_round_timer(0044 정의 + 한 줄)
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
  -- round_start_at은 "타이머를 (다시) 연 시각". round_paused_at도 함께 지운다(새로 여니까).
  update game_state set round_start_at = v_start, round_ends_at = v_ends, round_paused_at = null, is_locked = false where id = 1;

  perform emit_signal('timer_started', jsonb_build_object('round', v_round, 'ends_at', v_ends));
  return jsonb_build_object('ok', true, 'round', v_round, 'ends_at', v_ends, 'seconds', coalesce(v_dur, 600));
end;
$$;
grant execute on function start_round_timer(text, int) to anon, authenticated;
