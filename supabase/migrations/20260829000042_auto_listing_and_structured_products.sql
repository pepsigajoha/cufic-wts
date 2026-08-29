-- 표준 옵션 자동 상장 + 구조화 상품(ELS) 기초(draft, dev DB 전용 적용 예정).
--
-- ═══════════════════════════════════════════════════════════════════════════
-- [중요한 설계 판단 — 요청 문구를 그대로 옮기지 않고 이 게임 규칙에 맞게 해석함]
--
-- 요청에는 "만기 = 이번 라운드 끝"이라고 돼 있었다. 하지만 이 게임에서 라운드 중
-- 공식가(current_price)는 라운드 내내 고정이다(연도 넘기기 때만 바뀐다) — 그래서
-- "이번 라운드에 상장해서 이번 라운드 끝에 정산"하면 상장 시점 스팟과 정산 시점 스팟이
-- 항상 완전히 같아서(중간에 가격이 안 바뀌므로) 옵션이 매번 등가격으로 무의미하게
-- 정산된다. 실제 위험(다음 라운드에 가격이 어느 쪽으로, 얼마나 튈지 모르는 것)에 대한
-- 헷지가 안 된다는 뜻 — 이 게임에서 옵션이 의미 있으려면 "지금 라운드 가격 대비, 다음
-- 라운드 가격 공개"에 거는 것이어야 한다.
--
-- 그래서 여기서는: 라운드 N이 열릴 때(advance_round가 current_round를 N으로 올린 직후)
-- 그 종목의 지금 가격(=라운드 N의 공식가)을 행사가로, 만기를 N+1로 자동 상장한다.
-- place_option_order는 이미 expiry_round > current_round일 때만 매수를 허용하므로
-- (0037/0041), 이렇게 해야 상장 직후부터 실제로 살 수 있다 — expiry_round=N으로
-- 상장하면 그 즉시 "만기 지남"이 되어 아무도 살 수 없는 죽은 계약이 된다.
-- settle_options_round(N+1)은 기존 로직 그대로(0041) 그 다음 advance_round 때 자동 정산한다.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 종목별 기본 변동성(선택) — 관리자가 나중에 지정할 수 있게 컬럼만 미리 둔다.
-- 지금은 이 컬럼을 채우는 화면이 없다(AdminStocks 편집 UI는 이번 범위 밖) — null이면
-- 자동상장이 기본값 0.25를 쓴다. 필요해지면 AdminStocks.jsx에 입력칸만 추가하면 된다.
-- ─────────────────────────────────────────────
alter table stocks add column if not exists default_iv numeric check (default_iv is null or default_iv > 0);
comment on column stocks.default_iv is
  '자동상장 옵션의 기본 변동성(σ). null이면 auto_list_round_options가 0.25를 쓴다. 편집 UI 없음(직접 SQL/추후 추가).';

-- ─────────────────────────────────────────────
-- 표준 옵션 자동 상장 — 내부 전용(anon revoke). advance_round가 라운드 전환마다 호출한다.
-- p_round = 방금 새로 공개된 라운드(=행사가 기준 라운드). 만기는 p_round+1로 고정.
-- 거래정지(가격 0)·아직 상장 전 종목은 대상에서 뺀다.
-- ─────────────────────────────────────────────
create or replace function auto_list_round_options(p_round int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into options_contracts (stock_id, option_type, strike, expiry_round, implied_vol, risk_free_rate, created_round)
  select s.id, t.option_type, current_price(s.id), p_round + 1, coalesce(s.default_iv, 0.25), 0.03, p_round
  from stocks s
  cross join (values ('put'), ('call')) as t(option_type)
  where coalesce(current_price(s.id), 0) > 0
    and s.listed_from_round <= p_round;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function auto_list_round_options(int) from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- advance_round — 최신 정의(0041)에 자동상장 호출 한 줄만 추가.
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
  v_dist jsonb := jsonb_build_object('granted', 0, 'warnings', '[]'::jsonb);
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  select current_round, total_rounds into v_cur, v_total from game_state where id = 1 for update;

  if v_cur >= v_total then
    return jsonb_build_object('ok', false, 'error', 'already_last_round');
  end if;

  if v_cur < 1 then
    update game_state set current_round = 1, round_ends_at = null, is_locked = false where id = 1;
    perform accrue_savings_interest(1);
    perform settle_options_round(1);
    perform auto_list_round_options(1);
    perform emit_signal('round_advanced', jsonb_build_object('round', 1));
    return jsonb_build_object('ok', true, 'current_round', 1, 'hints', v_dist);
  end if;

  insert into round_snapshots (team_id, round, equity)
  select t.id, v_cur, team_equity(t.id) from teams t
  on conflict (team_id, round) do update set equity = excluded.equity;

  update game_state set current_round = v_cur + 1, round_ends_at = null, is_locked = false where id = 1;

  perform accrue_savings_interest(v_cur + 1);
  perform settle_options_round(v_cur + 1);
  perform auto_list_round_options(v_cur + 1);

  v_dist := distribute_round_hints(v_cur + 1);

  perform emit_signal('round_advanced', jsonb_build_object('round', v_cur + 1));
  if (v_dist ->> 'granted')::int > 0 then
    perform emit_signal('hints_changed', jsonb_build_object('auto', true, 'round', v_cur + 1));
  end if;

  return jsonb_build_object('ok', true, 'current_round', v_cur + 1, 'hints', v_dist);
end;
$$;

grant execute on function advance_round(text) to anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 구조화 상품(ELS) 기초 — 요청에 "Optional/Advanced, foundation"이라고 명시된 대로
-- 스키마 + 발행 RPC만 만든다. 넉인 배리어 감시·쿠폰 지급·조기상환·만기상환은 전혀 없다
-- (발행 시점에 담보(현금)를 잠그기만 하고, 그 뒤로는 아무 로직도 자동으로 안 돈다).
-- 실제로 쓰려면 최소한 "라운드마다 배리어 터치 확인 + 쿠폰/상환 RPC"가 더 필요하다 —
-- 이번엔 그 설계까지는 요청 범위 밖이라 만들지 않았다.
-- ═══════════════════════════════════════════════════════════════════════════

create table structured_products (
  id bigint generated always as identity primary key,
  issuer_team_id uuid not null references teams(id) on delete cascade,
  underlying_stock_id text not null references stocks(id),
  strike_price bigint not null check (strike_price > 0),
  knock_in_barrier_pct numeric not null check (knock_in_barrier_pct > 0 and knock_in_barrier_pct <= 100), -- 예: 80 = 행사가의 80%
  coupon_rate numeric not null check (coupon_rate >= 0), -- 예: 8 = 연 8%(표시용 — 실제 지급 로직 없음)
  total_issuance bigint not null check (total_issuance > 0), -- 발행팀 현금에서 담보로 잠기는 금액(원)
  issued_round int not null,
  status text not null default 'active' check (status in ('active', 'redeemed', 'defaulted')),
  created_at timestamptz not null default now()
);

create index structured_products_issuer_idx on structured_products (issuer_team_id);

alter table structured_products enable row level security;
create policy "read structured_products" on structured_products for select using (true); -- 과거·현재 발행 사실 — 스포일러 아님

-- ─────────────────────────────────────────────
-- 발행 — 발행팀 현금에서 total_issuance만큼 담보로 차감하고 행을 만든다.
-- 상환·쿠폰 지급 로직 없음(위 주석 참고) — 담보는 지금은 되돌려주는 경로가 없다.
-- ─────────────────────────────────────────────
create or replace function issue_structured_product(
  p_team_code text,
  p_underlying_stock_id text,
  p_strike_price bigint,
  p_knock_in_barrier_pct numeric,
  p_coupon_rate numeric,
  p_total_issuance bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team teams%rowtype;
  v_round int;
  v_id bigint;
begin
  if p_total_issuance is null or p_total_issuance <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;
  if p_knock_in_barrier_pct is null or p_knock_in_barrier_pct <= 0 or p_knock_in_barrier_pct > 100 then
    return jsonb_build_object('ok', false, 'error', 'invalid_barrier');
  end if;

  select current_round into v_round from game_state where id = 1;
  if v_round is null or v_round < 1 then
    return jsonb_build_object('ok', false, 'error', 'game_not_started');
  end if;

  if coalesce(current_price(p_underlying_stock_id), 0) <= 0 then
    return jsonb_build_object('ok', false, 'error', 'suspended');
  end if;

  select * into v_team from teams where code = p_team_code for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'team_not_found');
  end if;
  if v_team.cash < p_total_issuance then
    return jsonb_build_object('ok', false, 'error', 'insufficient_cash');
  end if;

  update teams set cash = cash - p_total_issuance where id = v_team.id;

  insert into structured_products (
    issuer_team_id, underlying_stock_id, strike_price, knock_in_barrier_pct,
    coupon_rate, total_issuance, issued_round
  )
  values (v_team.id, p_underlying_stock_id, p_strike_price, p_knock_in_barrier_pct, p_coupon_rate, p_total_issuance, v_round)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'product_id', v_id, 'new_cash', v_team.cash - p_total_issuance);
end;
$$;

grant execute on function issue_structured_product(text, text, bigint, numeric, numeric, bigint) to anon, authenticated;

-- reset_game — 자동상장 계약도 옵션 계약이니 기존 로직(0041)이 이미 지운다. structured_products만 추가.
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
    set current_round = 0, is_locked = false, is_ended = false, round_ends_at = null
  where id = 1;

  perform emit_signal('game_reset', '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function reset_game(text) to anon, authenticated;
