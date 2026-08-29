-- Derivatives/Hedging (Options) — draft, dev DB(dqvcagrbkvhnetqydgnk) 전용 적용 예정.
--
-- [범위를 의도적으로 좁힌다] 매수(롱)만 지원한다 — 옵션 매도(발행/숏)는 이번 범위 밖이다.
-- 이유: 네이키드 콜 매도는 이론상 무한 손실이라 증거금(margin) 시스템 없이는 교육용 게임에
-- 안전하게 넣을 수 없다. "보유 주식 헷지용 풋 매수"라는 요청 취지 자체가 롱 포지션만
-- 필요로 한다. user_options_positions에 side 컬럼을 안 둔 것도 같은 이유(항상 롱이라 불필요).
--
-- [설계 선택]
--  * σ(변동성)·r(무위험금리)는 계약 생성 시 관리자가 직접 입력한다(실제 IV 시장처럼).
--    round_configs의 매크로 금리에서 자동 유도하지 않는다 — 그 결합은 나중에 필요해지면
--    추가하고, 지금은 place_order의 검증된 흐름을 안 건드리는 쪽을 택했다.
--  * S(기초자산가)는 place_order와 완전히 같은 방식(공식가 중심 tick_price)으로 서버가 직접
--    계산한다(private.live_tick_price) — place_order 본문은 건드리지 않고 별도 헬퍼로 뽑았다
--    (이미 검증된 실거래 경로에 손대는 리스크를 피하려고 중복을 약간 감수함).
--  * 정산(만기)의 기초자산가는 "그 라운드의 공식가"를 쓴다(tick 아님) — 만기 시점엔 흔들림
--    개념이 의미가 없고, place_order의 평가 기준(current_price)과 같은 축으로 맞춰야
--    포지션 손익이 설명 가능하다.
--  * Put-Call Parity(C - P = S - Ke^(-rT))는 별도 코드로 "유지"하는 게 아니다 — 두 공식을
--    올바르게 구현하면 수학적으로 자동 성립하는 항등식이다. 검증 스크립트에서 어설션으로
--    확인한다(로직으로 강제하지 않음).

-- ─────────────────────────────────────────────
-- 표준정규분포 누적분포함수 Φ(x) — Abramowitz & Stegun 7.1.26 근사(오차 ~1.5e-7)
-- ─────────────────────────────────────────────
create or replace function private.norm_cdf(x double precision)
returns double precision
language plpgsql
immutable
as $$
declare
  z double precision := abs(x) / sqrt(2.0);
  t double precision;
  erf_z double precision;
  sgn double precision := case when x < 0 then -1.0 else 1.0 end;
  a1 constant double precision := 0.254829592;
  a2 constant double precision := -0.284496736;
  a3 constant double precision := 1.421413741;
  a4 constant double precision := -1.453152027;
  a5 constant double precision := 1.061405429;
  p  constant double precision := 0.3275911;
begin
  t := 1.0 / (1.0 + p * z);
  erf_z := 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * exp(-z * z);
  return 0.5 * (1.0 + sgn * erf_z);
end;
$$;

-- ─────────────────────────────────────────────
-- Black-Scholes-Merton (배당 없음). p_years<=0이면 만기 시점 내재가치만 반환.
-- ─────────────────────────────────────────────
create or replace function private.calc_black_scholes(
  p_spot double precision,
  p_strike double precision,
  p_years double precision,
  p_vol double precision,
  p_rate double precision,
  p_type text
)
returns double precision
language plpgsql
immutable
as $$
declare
  d1 double precision;
  d2 double precision;
begin
  if p_type not in ('call', 'put') then
    raise exception 'invalid option type: %', p_type;
  end if;
  if p_spot <= 0 or p_strike <= 0 then
    return 0;
  end if;
  if p_years <= 0 then
    if p_type = 'call' then return greatest(p_spot - p_strike, 0); end if;
    return greatest(p_strike - p_spot, 0);
  end if;
  if p_vol <= 0 then
    -- 변동성 0 = 확정적 미래가(무위험 성장) 기준 내재가치의 현재가치
    if p_type = 'call' then
      return greatest(p_spot - p_strike * exp(-p_rate * p_years), 0);
    end if;
    return greatest(p_strike * exp(-p_rate * p_years) - p_spot, 0);
  end if;

  d1 := (ln(p_spot / p_strike) + (p_rate + p_vol ^ 2 / 2.0) * p_years) / (p_vol * sqrt(p_years));
  d2 := d1 - p_vol * sqrt(p_years);

  if p_type = 'call' then
    return greatest(p_spot * private.norm_cdf(d1) - p_strike * exp(-p_rate * p_years) * private.norm_cdf(d2), 0);
  end if;
  return greatest(p_strike * exp(-p_rate * p_years) * private.norm_cdf(-d2) - p_spot * private.norm_cdf(-d1), 0);
end;
$$;

-- ─────────────────────────────────────────────
-- 라운드 안 "지금 이 순간"의 기초자산가 — place_order와 동일한 tick_price 계산을
-- 재사용하되, place_order 본문은 건드리지 않는다(위 [설계 선택] 참고).
-- ─────────────────────────────────────────────
create or replace function private.live_tick_price(p_stock_id text)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_official bigint;
  v_round int;
  v_ends_at timestamptz;
  v_remaining_ms double precision;
begin
  select current_round, round_ends_at into v_round, v_ends_at from game_state where id = 1;
  v_official := current_price(p_stock_id);
  if v_official is null or v_official <= 0 then
    return 0;
  end if;
  if v_ends_at is null or now() >= v_ends_at then
    return v_official; -- 타이머 닫혀 있으면 흔들림 없이 공식가 그대로
  end if;
  v_remaining_ms := extract(epoch from (v_ends_at - now())) * 1000;
  return private.tick_price(v_official, v_round, p_stock_id, now(), v_remaining_ms);
end;
$$;

-- ─────────────────────────────────────────────
-- 옵션 계약 (관리자가 만든다) — 공개 조회(학생이 프리미엄을 봐야 거래 가능)
-- ─────────────────────────────────────────────
create table options_contracts (
  id bigint generated always as identity primary key,
  stock_id text not null references stocks(id),
  option_type text not null check (option_type in ('call', 'put')),
  strike bigint not null check (strike > 0),
  expiry_round int not null,
  implied_vol numeric not null check (implied_vol > 0),         -- σ, 예: 0.35 = 연 35%
  risk_free_rate numeric not null default 0.02 check (risk_free_rate >= 0), -- r, 예: 0.02 = 2%
  created_round int not null,
  active boolean not null default true
);

create index options_contracts_stock_idx on options_contracts (stock_id, expiry_round);

alter table options_contracts enable row level security;
create policy "read options_contracts" on options_contracts for select using (true);

-- ─────────────────────────────────────────────
-- 보유 포지션 (전부 매수/롱). premium_paid = 진입 시 지불한 총 프리미엄(cash 즉시 차감).
-- ─────────────────────────────────────────────
create table user_options_positions (
  id bigint generated always as identity primary key,
  team_id uuid not null references teams(id) on delete cascade,
  contract_id bigint not null references options_contracts(id),
  quantity int not null check (quantity > 0),
  premium_paid bigint not null check (premium_paid >= 0),
  entry_round int not null,
  status text not null default 'open' check (status in ('open', 'settled', 'expired_worthless')),
  settled_payoff bigint,
  created_at timestamptz not null default now()
);

create index user_options_positions_team_idx on user_options_positions (team_id, status);

alter table user_options_positions enable row level security;
create policy "read user_options_positions" on user_options_positions for select using (true);

-- ─────────────────────────────────────────────
-- 계약 관리 (관리자)
-- ─────────────────────────────────────────────
create or replace function admin_upsert_options_contract(
  p_admin_secret text, p_stock_id text, p_option_type text, p_strike bigint,
  p_expiry_round int, p_implied_vol numeric, p_risk_free_rate numeric default 0.02
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round int;
  v_id bigint;
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  if p_option_type not in ('call', 'put') then
    return jsonb_build_object('ok', false, 'error', 'invalid_type');
  end if;
  select current_round into v_round from game_state where id = 1;
  if p_expiry_round is null or p_expiry_round <= coalesce(v_round, 0) then
    return jsonb_build_object('ok', false, 'error', 'invalid_expiry');
  end if;

  insert into options_contracts (stock_id, option_type, strike, expiry_round, implied_vol, risk_free_rate, created_round)
  values (p_stock_id, p_option_type, p_strike, p_expiry_round, p_implied_vol, coalesce(p_risk_free_rate, 0.02), coalesce(v_round, 0))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function admin_deactivate_options_contract(p_admin_secret text, p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  update options_contracts set active = false where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function admin_upsert_options_contract(text, text, text, bigint, int, numeric, numeric) to anon, authenticated;
grant execute on function admin_deactivate_options_contract(text, bigint) to anon, authenticated;

-- ─────────────────────────────────────────────
-- 실시간 프리미엄 조회 (공개, 주문 전 미리보기용) — place_option_order와 같은 공식을 쓴다.
-- ─────────────────────────────────────────────
create or replace function quote_option_premium(p_contract_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_contract options_contracts%rowtype;
  v_round int;
  v_spot bigint;
  v_years double precision;
  v_premium double precision;
begin
  select * into v_contract from options_contracts where id = p_contract_id and active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'contract_not_found');
  end if;
  select current_round into v_round from game_state where id = 1;
  v_spot := private.live_tick_price(v_contract.stock_id);
  v_years := greatest((v_contract.expiry_round - coalesce(v_round, 0))::double precision, 0);
  v_premium := private.calc_black_scholes(
    v_spot::double precision, v_contract.strike::double precision, v_years,
    v_contract.implied_vol, v_contract.risk_free_rate, v_contract.option_type
  );
  return jsonb_build_object(
    'ok', true, 'spot', v_spot, 'strike', v_contract.strike, 'years_to_expiry', v_years,
    'premium_per_unit', round(v_premium)
  );
end;
$$;

grant execute on function quote_option_premium(bigint) to anon, authenticated;

-- ─────────────────────────────────────────────
-- 매수 주문 (롱 전용). place_order와 동일하게 팀 행을 잠그고, 타이머 열려 있을 때만 허용한다.
-- ─────────────────────────────────────────────
create or replace function place_option_order(p_team_code text, p_contract_id bigint, p_quantity int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team teams%rowtype;
  v_contract options_contracts%rowtype;
  v_round int;
  v_ends_at timestamptz;
  v_spot bigint;
  v_years double precision;
  v_premium_per_unit double precision;
  v_total_premium bigint;
  v_id bigint;
begin
  if p_quantity is null or p_quantity <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_quantity');
  end if;

  select current_round, round_ends_at into v_round, v_ends_at from game_state where id = 1;
  if v_round is null or v_round < 1 then
    return jsonb_build_object('ok', false, 'error', 'game_not_started');
  end if;
  if v_ends_at is null or now() >= v_ends_at then
    return jsonb_build_object('ok', false, 'error', 'round_closed');
  end if;

  select * into v_contract from options_contracts where id = p_contract_id and active for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'contract_not_found');
  end if;
  if v_contract.expiry_round <= v_round then
    return jsonb_build_object('ok', false, 'error', 'contract_expired');
  end if;

  select * into v_team from teams where code = p_team_code for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'team_not_found');
  end if;

  v_spot := private.live_tick_price(v_contract.stock_id);
  if v_spot <= 0 then
    return jsonb_build_object('ok', false, 'error', 'suspended');
  end if;

  v_years := (v_contract.expiry_round - v_round)::double precision;
  v_premium_per_unit := private.calc_black_scholes(
    v_spot::double precision, v_contract.strike::double precision, v_years,
    v_contract.implied_vol, v_contract.risk_free_rate, v_contract.option_type
  );
  v_total_premium := round(v_premium_per_unit * p_quantity);

  if v_team.cash < v_total_premium then
    return jsonb_build_object('ok', false, 'error', 'insufficient_cash');
  end if;

  update teams set cash = cash - v_total_premium where id = v_team.id;

  insert into user_options_positions (team_id, contract_id, quantity, premium_paid, entry_round)
  values (v_team.id, p_contract_id, p_quantity, v_total_premium, v_round)
  returning id into v_id;

  return jsonb_build_object(
    'ok', true, 'position_id', v_id, 'premium_per_unit', round(v_premium_per_unit),
    'total_premium', v_total_premium, 'spot_used', v_spot, 'new_cash', v_team.cash - v_total_premium
  );
end;
$$;

grant execute on function place_option_order(text, bigint, int) to anon, authenticated;

-- ─────────────────────────────────────────────
-- 만기 정산 — 내부 전용. expiry_round에 도달한 열린 포지션을 내재가치(T=0)로 정산해 cash에 반영.
-- 기초자산가는 그 라운드의 "공식가"를 쓴다(tick 아님 — 위 [설계 선택] 참고).
-- ─────────────────────────────────────────────
create or replace function settle_options_round(p_round int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  with due as (
    select up.id,
           round(private.calc_black_scholes(
             current_price(oc.stock_id)::double precision, oc.strike::double precision,
             0, oc.implied_vol, oc.risk_free_rate, oc.option_type
           ) * up.quantity)::bigint as payoff
    from user_options_positions up
    join options_contracts oc on oc.id = up.contract_id
    where up.status = 'open' and oc.expiry_round = p_round
  )
  update user_options_positions up
    set status = case when due.payoff > 0 then 'settled' else 'expired_worthless' end,
        settled_payoff = due.payoff
  from due
  where up.id = due.id;

  get diagnostics v_count = row_count;

  update teams t set cash = t.cash + pay.total
  from (
    select up.team_id, sum(up.settled_payoff) as total
    from user_options_positions up
    join options_contracts oc on oc.id = up.contract_id
    where oc.expiry_round = p_round and up.status in ('settled', 'expired_worthless')
    group by up.team_id
  ) pay
  where pay.team_id = t.id;

  return v_count;
end;
$$;

revoke all on function settle_options_round(int) from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- advance_round — 최신 정의(0040)에 옵션 정산 호출 한 줄만 추가.
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
    perform emit_signal('round_advanced', jsonb_build_object('round', 1));
    return jsonb_build_object('ok', true, 'current_round', 1, 'hints', v_dist);
  end if;

  insert into round_snapshots (team_id, round, equity)
  select t.id, v_cur, team_equity(t.id) from teams t
  on conflict (team_id, round) do update set equity = excluded.equity;

  update game_state set current_round = v_cur + 1, round_ends_at = null, is_locked = false where id = 1;

  perform accrue_savings_interest(v_cur + 1);
  perform settle_options_round(v_cur + 1);

  v_dist := distribute_round_hints(v_cur + 1);

  perform emit_signal('round_advanced', jsonb_build_object('round', v_cur + 1));
  if (v_dist ->> 'granted')::int > 0 then
    perform emit_signal('hints_changed', jsonb_build_object('auto', true, 'round', v_cur + 1));
  end if;

  return jsonb_build_object('ok', true, 'current_round', v_cur + 1, 'hints', v_dist);
end;
$$;

grant execute on function advance_round(text) to anon, authenticated;

-- ─────────────────────────────────────────────
-- admin_end_game — 최신 정의(0040)에 옵션 정산 호출 한 줄만 추가.
-- ─────────────────────────────────────────────
create or replace function admin_end_game(p_admin_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cur int;
  v_total int;
  v_final int;
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  select current_round, total_rounds, final_year into v_cur, v_total, v_final from game_state where id = 1 for update;
  if v_cur < 1 then
    return jsonb_build_object('ok', false, 'error', 'game_not_started');
  end if;

  insert into round_snapshots (team_id, round, equity)
  select t.id, v_cur, team_equity(t.id) from teams t
  on conflict (team_id, round) do update set equity = excluded.equity;

  update game_state
    set current_round = v_total + 1, is_ended = true, is_locked = false, round_ends_at = null
  where id = 1;

  perform accrue_savings_interest(v_total + 1);
  perform settle_options_round(v_total + 1);

  insert into round_snapshots (team_id, round, equity)
  select t.id, v_total + 1, team_equity(t.id) from teams t
  on conflict (team_id, round) do update set equity = excluded.equity;

  perform emit_signal('game_ended', jsonb_build_object('round', v_total + 1, 'final_year', v_final));
  return jsonb_build_object('ok', true, 'final_year', v_final, 'round', v_total + 1);
end;
$$;

grant execute on function admin_end_game(text) to anon, authenticated;

-- reset_game — 옵션 계약·포지션도 다음 판을 위해 지운다.
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
