-- current_price: security definer 복원.
--
-- 배경: 0008에서 current_price를 `security definer` + `set search_path=public`로 만들었으나,
--       0016의 `create or replace`가 그 두 속성 없이 재정의하면서 유실됐다(현재 security invoker).
--       지금은 stocks·game_state가 공개 읽기(using(true))라 anon·definer 함수 양쪽에서 정상 동작하지만,
--       훗날 그 두 테이블 RLS를 조이면 team_equity 같은 definer 함수가 내부에서 current_price를 부를 때
--       조용히 0을 반환할 수 있다. team_equity·team_cash와 권한 속성을 일치시켜 그 잠복 위험을 없앤다.
--
-- ⚠ 앞으로 current_price를 `create or replace`로 다시 정의할 때는 아래 두 줄(security definer,
--    set search_path=public)을 반드시 함께 유지할 것. 빠뜨리면 같은 회귀가 재발한다.

create or replace function current_price(p_stock_id text)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (s.prices ->> coalesce(g.round_year_map ->> g.current_round::text, g.final_year::text))::bigint,
    0)
  from stocks s
  cross join game_state g
  where s.id = p_stock_id and g.id = 1;
$$;

comment on function current_price(text) is
  'security definer 필수 — team_equity 등 definer 함수가 내부에서 호출한다. 재정의 시 유지할 것(0018).';

grant execute on function current_price(text) to anon, authenticated;
