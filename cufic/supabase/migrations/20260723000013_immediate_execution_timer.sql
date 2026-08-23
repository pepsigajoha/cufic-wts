-- 주문서 일괄체결 → 즉시 체결 + 라운드 타이머로 전환
--
-- 작년 방식으로 되돌린다: 매수·매도가 즉시 체결된다(place_order 부활).
-- 대신 라운드마다 관리자가 '타이머 시작'을 눌러야 거래가 열리고, 10분 뒤 자동으로 닫힌다.
--
-- 게임 루프 (관리자):
--   1) advance_round     : 다음 연도 공개 → 보유 재평가 → 순위 변동. 타이머는 꺼진 채(거래 잠김).
--   2) 순위 확인
--   3) start_round_timer : round_ends_at = now() + duration. 거래 열림.
--   4) 학생 즉시 매매. now() >= round_ends_at 이 되면 서버가 거부 = 자동 잠김. 관리자가 다시 1)로.
--
-- 주문서(order_sheets)는 더는 쓰지 않는다. 파괴적 drop 없이 휴면 상태로 남긴다
--   (order_sheets 테이블·save_order_sheet·get_my_order_sheet는 그대로 두되 아무도 호출하지 않는다).

-- ─────────────────────────────────────────────
-- 타이머 상태 (game_state)
-- ─────────────────────────────────────────────
alter table game_state
  add column if not exists round_ends_at timestamptz,
  add column if not exists round_duration_seconds int not null default 600;

comment on column game_state.round_ends_at is
  '현재 라운드 거래 마감 시각. null이면 거래 닫힘(타이머 시작 전이거나 이미 지남). place_order가 now()와 비교한다.';
comment on column game_state.round_duration_seconds is
  '라운드 거래 시간(초). 기본 600=10분. 하드코딩 대신 설정값으로 둔다(조 수·시드처럼).';

-- ─────────────────────────────────────────────
-- 즉시 체결 (부활) — 서버가 유일한 심판.
--   작년 시트 수식과 동일:
--     평균단가 = 총 매수금액 / 총 매수수량   (매수 시 가중평균 재계산)
--     실현손익 = (체결가 - 평균단가) * 수량   (매도 시점에 확정)
--   타이머 밖 거래는 서버가 거부한다(학생이 콘솔로 우회해도 막힌다).
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

-- ─────────────────────────────────────────────
-- 연도 넘기기 — 정산 없음(즉시 체결이므로 이미 반영됨).
--   새 가격 공개 + 스냅샷(순위 등락·수익률 차트) + 타이머 초기화(거래 닫힘).
-- ─────────────────────────────────────────────
create or replace function advance_round(p_admin_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cur int;
  v_total int;
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  select current_round, total_rounds into v_cur, v_total from game_state where id = 1 for update;

  if v_cur >= v_total then
    return jsonb_build_object('ok', false, 'error', 'already_last_round');
  end if;

  -- 시작 전(0) → R1 열기. 타이머는 아직 시작하지 않는다(관리자가 따로 시작).
  if v_cur < 1 then
    update game_state set current_round = 1, round_ends_at = null, is_locked = false where id = 1;
    perform emit_signal('round_advanced', jsonb_build_object('round', 1));
    return jsonb_build_object('ok', true, 'current_round', 1);
  end if;

  -- 떠나는 라운드의 평가금액을 전 팀 기록. current_round가 아직 안 바뀌었으므로
  -- team_equity()가 '이번 라운드 가격'으로 계산한다 = 넘어가기 직전 자산.
  insert into round_snapshots (team_id, round, equity)
  select t.id, v_cur, team_equity(t.id) from teams t
  on conflict (team_id, round) do update set equity = excluded.equity;

  -- 새 연도 공개 + 타이머 초기화. 관리자가 순위 확인 후 start_round_timer로 거래를 연다.
  update game_state
    set current_round = v_cur + 1, round_ends_at = null, is_locked = false
  where id = 1;

  perform emit_signal('round_advanced', jsonb_build_object('round', v_cur + 1));

  return jsonb_build_object('ok', true, 'current_round', v_cur + 1);
end;
$$;

grant execute on function advance_round(text) to anon, authenticated;

-- ─────────────────────────────────────────────
-- 라운드 타이머 시작 (관리자) — 거래를 연다.
--   round_ends_at = now() + round_duration_seconds. 그때까지 place_order 허용.
-- ─────────────────────────────────────────────
create or replace function start_round_timer(p_admin_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round int;
  v_dur int;
  v_ends timestamptz;
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  select current_round, round_duration_seconds into v_round, v_dur from game_state where id = 1 for update;
  if v_round is null or v_round < 1 then
    return jsonb_build_object('ok', false, 'error', 'game_not_started');
  end if;

  v_ends := now() + make_interval(secs => coalesce(v_dur, 600));
  update game_state set round_ends_at = v_ends, is_locked = false where id = 1;

  perform emit_signal('timer_started', jsonb_build_object('round', v_round, 'ends_at', v_ends));

  return jsonb_build_object('ok', true, 'round', v_round, 'ends_at', v_ends);
end;
$$;

grant execute on function start_round_timer(text) to anon, authenticated;

-- ─────────────────────────────────────────────
-- 관리자: 조별 현황 — '주문서 제출' 대신 '이번 라운드 거래 수'
-- ─────────────────────────────────────────────
create or replace function admin_teams_status(p_admin_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round int;
  v_rows jsonb;
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  select current_round into v_round from game_state where id = 1;

  select coalesce(jsonb_agg(x order by x ->> 'code'), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'id', t.id, 'code', t.code, 'name', t.name,
      'seed', t.seed, 'cash', t.cash,
      'equity', team_equity(t.id),
      'pnl', team_equity(t.id) - t.seed,
      'pnl_pct', case when t.seed > 0
                      then round(((team_equity(t.id) - t.seed)::numeric / t.seed) * 100, 2)
                      else 0 end,
      -- 이번 라운드에 이 조가 몇 건 거래했는지 (즉시 체결 기준)
      'trades_this_round', (select count(*) from trades tr where tr.team_id = t.id and tr.round = v_round),
      'hint_count', (select count(*) from hint_grants hg where hg.team_id = t.id)
    ) as x
    from teams t
  ) s;

  return jsonb_build_object('ok', true, 'round', v_round, 'teams', v_rows);
end;
$$;

grant execute on function admin_teams_status(text) to anon, authenticated;

-- ─────────────────────────────────────────────
-- 게임 리셋 — 타이머도 초기화한다.
-- ─────────────────────────────────────────────
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

  update game_state set current_round = 0, is_locked = false, round_ends_at = null where id = 1;

  perform emit_signal('game_reset', '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function reset_game(text) to anon, authenticated;
