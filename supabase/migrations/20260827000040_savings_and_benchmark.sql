-- Phase 1 / Feature 3 — 예금(고정금리 복리) 상품 + 최종 라운드 벤치마크 비교(draft, dev DB 전용 적용 예정).
--
-- [중요 — team_equity에 반드시 반영해야 함] 예금에 넣은 돈은 teams.cash에서 빠지지만 사라진
-- 게 아니다. team_equity()가 user_savings.balance를 더하지 않으면, 예금 가입 즉시 평가금액이
-- (겉보기로) 줄어들어 리더보드가 왜곡된다. 이 마이그레이션에서 team_equity를 반드시 같이
-- 재정의한다 — 누락하면 예금 기능 자체가 게임을 깨뜨린다.
--
-- [확정됨]
--  * 벤치마크 지수 = 전 종목(현재 18개) R1 대비 단순평균 수익률. 상장시점 필터 없음.
--  * 중도해지 페널티 = 원금 100% 반환 + 누적이자 50%만 지급(아래 withdraw_savings 참고).
--    "중도해지" = withdraw_savings를 호출하는 모든 경우로 정의한다 — team_equity()가 이미
--    활성 예금 잔액을 만기 전에도 전액 평가금액에 반영하므로(위 주석 참고), 굳이 withdraw를
--    부르는 이유는 항상 "게임 종료 전에 현금화하고 싶어서"뿐이다. 그래서 별도의 만기/락업
--    기간 컬럼 없이 "명시적 해지 = 중도해지"로 취급해도 의미가 어긋나지 않는다.
--
-- [아직 미확정] "100% 고정예금" 비교 시 어떤 상품(annual_rate)을 기준으로 할지 —
--   p_product_id 생략 시 지금은 활성 상품 중 annual_rate가 가장 높은 상품을 기본값으로 썼다.
--   다른 기준(예: 특정 상품 고정)을 원하면 알려주면 그 부분만 바꾼다.

create table savings_products (
  id text primary key,                                   -- 예: 'BASIC_3PCT'
  name text not null,
  annual_rate numeric not null check (annual_rate >= 0),  -- 라운드(=1년) 복리 이자율(%)
  min_amount bigint not null default 0 check (min_amount >= 0),
  active boolean not null default true
);

alter table savings_products enable row level security;
create policy "read savings_products" on savings_products for select using (true); -- 공개 상품 카탈로그, 스포일러 아님

create table user_savings (
  id bigint generated always as identity primary key,
  team_id uuid not null references teams(id) on delete cascade,
  product_id text not null references savings_products(id),
  principal bigint not null check (principal > 0),
  balance bigint not null check (balance >= 0),
  start_round int not null,
  last_accrued_round int not null,
  status text not null default 'active' check (status in ('active', 'withdrawn')),
  created_at timestamptz not null default now()
);

create index user_savings_team_idx on user_savings (team_id, status);

alter table user_savings enable row level security;
-- positions/trades와 동일하게 전면 공개 read (조별 프라이버시는 참가 코드 비공개로 이미 처리됨).
create policy "read user_savings" on user_savings for select using (true);

-- ─────────────────────────────────────────────
-- 상품 관리 (관리자) — admin_upsert_stock과 동일 패턴
-- ─────────────────────────────────────────────
create or replace function admin_upsert_savings_product(
  p_admin_secret text, p_id text, p_name text, p_annual_rate numeric,
  p_min_amount bigint default 0, p_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  if p_annual_rate is null or p_annual_rate < 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_rate');
  end if;

  insert into savings_products (id, name, annual_rate, min_amount, active)
  values (p_id, p_name, p_annual_rate, coalesce(p_min_amount, 0), coalesce(p_active, true))
  on conflict (id) do update
    set name = excluded.name, annual_rate = excluded.annual_rate,
        min_amount = excluded.min_amount, active = excluded.active;

  return jsonb_build_object('ok', true, 'id', p_id);
end;
$$;

create or replace function admin_delete_savings_product(p_admin_secret text, p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  delete from savings_products where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function admin_upsert_savings_product(text, text, text, numeric, bigint, boolean) to anon, authenticated;
grant execute on function admin_delete_savings_product(text, text) to anon, authenticated;

-- ─────────────────────────────────────────────
-- team_equity 재정의 — 활성 예금 잔액을 평가금액에 합산 (기존 계산 + 이 한 줄)
-- ─────────────────────────────────────────────
create or replace function team_equity(p_team_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select t.cash
    + coalesce((select sum(p.quantity::bigint * current_price(p.stock_id)) from positions p where p.team_id = t.id), 0)::bigint
    + coalesce((select sum(s.balance) from user_savings s where s.team_id = t.id and s.status = 'active'), 0)::bigint
  from teams t
  where t.id = p_team_id;
$$;

grant execute on function team_equity(uuid) to anon, authenticated;

-- ─────────────────────────────────────────────
-- 가입 — cash에서 원금을 빼고 잔액=원금으로 시작. place_order와 동일하게 팀 행을 잠근다.
-- 거래 타이머와 무관하게 언제든 가능(예금은 "거래"가 아니라 자산배분 결정이라 판단).
-- ─────────────────────────────────────────────
create or replace function open_savings(p_team_code text, p_product_id text, p_amount bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team teams%rowtype;
  v_product savings_products%rowtype;
  v_round int;
  v_id bigint;
begin
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;

  select current_round into v_round from game_state where id = 1;
  if v_round is null or v_round < 1 then
    return jsonb_build_object('ok', false, 'error', 'game_not_started');
  end if;

  select * into v_product from savings_products where id = p_product_id and active;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'product_not_found');
  end if;
  if p_amount < v_product.min_amount then
    return jsonb_build_object('ok', false, 'error', 'below_min_amount');
  end if;

  select * into v_team from teams where code = p_team_code for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'team_not_found');
  end if;
  if v_team.cash < p_amount then
    return jsonb_build_object('ok', false, 'error', 'insufficient_cash');
  end if;

  update teams set cash = cash - p_amount where id = v_team.id;

  insert into user_savings (team_id, product_id, principal, balance, start_round, last_accrued_round)
  values (v_team.id, p_product_id, p_amount, p_amount, v_round, v_round)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'savings_id', v_id, 'new_cash', v_team.cash - p_amount);
end;
$$;

-- ─────────────────────────────────────────────
-- 해지 — 중도해지 페널티: 원금은 100% 반환, 누적이자(balance-principal)는 50%만 지급.
-- 나머지 50%는 그냥 소멸(팀에도 게임 전체에도 재분배하지 않는다 — 단순 페널티).
-- ─────────────────────────────────────────────
create or replace function withdraw_savings(p_team_code text, p_savings_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team teams%rowtype;
  v_saving user_savings%rowtype;
  v_interest bigint;
  v_payout bigint;
  v_forfeited bigint;
begin
  select * into v_team from teams where code = p_team_code for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'team_not_found');
  end if;

  select * into v_saving from user_savings
  where id = p_savings_id and team_id = v_team.id and status = 'active'
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'savings_not_found');
  end if;

  v_interest := greatest(v_saving.balance - v_saving.principal, 0);
  v_payout := v_saving.principal + round(v_interest * 0.5);
  v_forfeited := v_saving.balance - v_payout;

  update user_savings set status = 'withdrawn', balance = v_payout where id = p_savings_id;
  update teams set cash = cash + v_payout where id = v_team.id;

  return jsonb_build_object(
    'ok', true, 'principal', v_saving.principal, 'accrued_interest', v_interest,
    'payout', v_payout, 'forfeited_interest', v_forfeited, 'new_cash', v_team.cash + v_payout
  );
end;
$$;

grant execute on function open_savings(text, text, bigint) to anon, authenticated;
grant execute on function withdraw_savings(text, bigint) to anon, authenticated;

-- ─────────────────────────────────────────────
-- 이자 반영 — 내부 전용(anon revoke). advance_round/admin_end_game이 라운드 전환마다 호출한다.
-- p_round(방금 공개된 라운드) 기준으로, 아직 그 라운드까지 반영 안 된 예금에 1회 복리 적용.
-- ─────────────────────────────────────────────
create or replace function accrue_savings_interest(p_round int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update user_savings s
    set balance = round(s.balance * (1 + p.annual_rate / 100.0)),
        last_accrued_round = p_round
  from savings_products p
  where p.id = s.product_id
    and s.status = 'active'
    and s.last_accrued_round < p_round;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function accrue_savings_interest(int) from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- advance_round — 최신 정의(0015)에 이자 반영 호출 한 줄만 추가.
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
    perform emit_signal('round_advanced', jsonb_build_object('round', 1));
    return jsonb_build_object('ok', true, 'current_round', 1, 'hints', v_dist);
  end if;

  insert into round_snapshots (team_id, round, equity)
  select t.id, v_cur, team_equity(t.id) from teams t
  on conflict (team_id, round) do update set equity = excluded.equity;

  update game_state set current_round = v_cur + 1, round_ends_at = null, is_locked = false where id = 1;

  perform accrue_savings_interest(v_cur + 1);

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
-- admin_end_game — 최신 정의(0017)에 이자 반영 호출 한 줄만 추가(최종 연도도 "한 라운드"로 취급).
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

  insert into round_snapshots (team_id, round, equity)
  select t.id, v_total + 1, team_equity(t.id) from teams t
  on conflict (team_id, round) do update set equity = excluded.equity;

  perform emit_signal('game_ended', jsonb_build_object('round', v_total + 1, 'final_year', v_final));
  return jsonb_build_object('ok', true, 'final_year', v_final, 'round', v_total + 1);
end;
$$;

grant execute on function admin_end_game(text) to anon, authenticated;

-- ─────────────────────────────────────────────
-- 최종 비교 — 내 포트폴리오 vs 100% 고정예금 vs 벤치마크 지수 (질문 1·2 참고, 자리표시자 구현)
-- ─────────────────────────────────────────────
create or replace function team_final_comparison(p_team_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_team teams%rowtype;
  v_actual_equity bigint;
  v_best_rate numeric;
  v_rounds_elapsed int;
  v_deposit_equity bigint;
  v_bench_return numeric;
  v_bench_equity bigint;
  v_round1_year text;
  v_cur_year text;
begin
  select * into v_team from teams where code = p_team_code;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'team_not_found');
  end if;

  v_actual_equity := team_equity(v_team.id);

  select current_round into v_rounds_elapsed from game_state where id = 1;
  v_rounds_elapsed := greatest(coalesce(v_rounds_elapsed, 0), 0);

  -- [질문 2] 기본값: 활성 상품 중 최고 금리로 "시드 전액을 게임 시작부터 지금까지 예금했다면"
  select max(annual_rate) into v_best_rate from savings_products where active;
  v_deposit_equity := round(v_team.seed * power(1 + coalesce(v_best_rate, 0) / 100.0, v_rounds_elapsed));

  -- [확정] 벤치마크 = 전 종목(현재 18개)의 라운드1 대비 단순 평균 수익률. 상장 시점 필터 없음 —
  -- 라운드1 가격이 없는 종목(추후 신규상장)은 아래 두 번째 조건에서 자연히 제외된다.
  select g.round_year_map ->> '1' into v_round1_year from game_state g where g.id = 1;
  select coalesce(g.round_year_map ->> g.current_round::text, g.final_year::text) into v_cur_year
    from game_state g where g.id = 1;

  select avg((s.prices ->> v_cur_year)::numeric / nullif((s.prices ->> v_round1_year)::numeric, 0)) - 1
    into v_bench_return
  from stocks s
  where coalesce((s.prices ->> v_cur_year)::numeric, 0) > 0
    and coalesce((s.prices ->> v_round1_year)::numeric, 0) > 0;

  v_bench_equity := round(v_team.seed * (1 + coalesce(v_bench_return, 0)));

  return jsonb_build_object(
    'ok', true,
    'seed', v_team.seed,
    'rounds_elapsed', v_rounds_elapsed,
    'actual_equity', v_actual_equity,
    'deposit_equity', v_deposit_equity,
    'deposit_rate_used', v_best_rate,
    'benchmark_equity', v_bench_equity,
    'benchmark_return_pct', round(coalesce(v_bench_return, 0) * 100, 2)
  );
end;
$$;

grant execute on function team_final_comparison(text) to anon, authenticated;

-- reset_game — 예금도 다음 판을 위해 지운다.
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
