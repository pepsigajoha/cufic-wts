-- 예금 금리를 거시지표 기준금리(macro.rate)에 연동한다.
--
-- [왜] 0040은 savings_products.annual_rate에 고정금리를 박아 뒀다. 그러면 관리자가 상품을
-- 따로 관리해야 하고, 무엇보다 "2022년 금리 인상 → 예금이 매력적이 된다"는 교육 포인트가
-- 데이터로 안 드러난다. 이제 그 해 기준금리를 그대로 쓴다 —
-- 시황판에서 학생이 읽는 기준금리와 예금 금리가 같은 숫자가 된다.
--
--   예금금리(%) = macro.rate(그 라운드 연도의 기준금리) + savings_products.annual_rate(가산금리, 기본 0)
--
-- annual_rate는 이제 "고정금리"가 아니라 "가산금리(스프레드)"다. 콘텐츠팀이 예금을 조금 더/덜
-- 매력적으로 만들고 싶을 때만 건드리는 값이고, 기본값 0이면 순수하게 기준금리를 따라간다.
-- 금리 자체는 엑셀 데이터셋/주가 생성기의 거시지표에서 이미 정해지므로 별도 상품 관리가 필요 없다.

-- ─────────────────────────────────────────────
-- 1. 기본 상품 한 개 — 학생은 상품을 고르지 않는다(예금은 하나뿐).
--    FK(user_savings.product_id) 때문에 행 자체는 필요하다.
-- ─────────────────────────────────────────────
insert into savings_products (id, name, annual_rate, min_amount, active)
values ('BASE', '정기예금', 0, 0, true)
on conflict (id) do nothing;

comment on column savings_products.annual_rate is
  '가산금리(스프레드, %p). 실제 예금금리 = 그 라운드 연도의 macro.rate + 이 값. 0이면 기준금리와 동일.';

-- ─────────────────────────────────────────────
-- 2. 그 라운드의 예금 금리(%) — 서버 이자 계산과 화면 표시가 같은 값을 쓰게 하는 단일 소스.
--    라운드 → 연도 변환은 exec_price와 동일 규칙(round_year_map, 없으면 final_year).
-- ─────────────────────────────────────────────
create or replace function savings_rate(p_round int)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_year int;
  v_base numeric;
  v_spread numeric;
begin
  select coalesce((g.round_year_map ->> p_round::text)::int, g.final_year)
    into v_year
  from game_state g where g.id = 1;

  select rate into v_base from macro where year = v_year;
  select annual_rate into v_spread from savings_products where id = 'BASE';

  return greatest(0, coalesce(v_base, 0) + coalesce(v_spread, 0));
end;
$$;

comment on function savings_rate(int) is
  '그 라운드에 적용되는 예금 금리(%). = 해당 연도 macro.rate + savings_products.BASE.annual_rate(가산). 학생 화면 표시와 accrue_savings_interest가 공유한다.';

grant execute on function savings_rate(int) to anon, authenticated;

-- ─────────────────────────────────────────────
-- 3. 이자 반영 — 상품 고정금리 대신 그 라운드 금리를 쓴다.
--    호출부(advance_round·admin_end_game)는 그대로. 내부 전용(anon revoke) 유지.
-- ─────────────────────────────────────────────
create or replace function accrue_savings_interest(p_round int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate numeric;
  v_count int;
begin
  v_rate := savings_rate(p_round);

  update user_savings s
    set balance = round(s.balance * (1 + v_rate / 100.0)),
        last_accrued_round = p_round
  where s.status = 'active'
    and s.last_accrued_round < p_round;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function accrue_savings_interest(int) from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 4. 가입 — 상품을 고를 이유가 없으므로 금액만 받는다.
--    옛 3-인자 시그니처는 drop한다(오버로드로 남으면 호출부가 헷갈린다).
-- ─────────────────────────────────────────────
drop function if exists open_savings(text, text, bigint);

create or replace function open_savings(p_team_code text, p_amount bigint)
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

  select * into v_product from savings_products where id = 'BASE' and active;
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
  values (v_team.id, 'BASE', p_amount, p_amount, v_round, v_round)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'savings_id', v_id, 'new_cash', v_team.cash - p_amount);
end;
$$;

grant execute on function open_savings(text, bigint) to anon, authenticated;
