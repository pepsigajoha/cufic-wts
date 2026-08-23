-- team_equity 수정: teams 읽기 정책을 없앤 뒤 anon 직접 호출이 NULL을 돌려주던 문제
--
-- 증상: REST로 team_equity()를 부르면 NULL. advance_round 안에서 부를 땐 멀쩡해서
--       스냅샷은 정상으로 보였다 — 겉으로 드러나지 않는 종류의 버그였다.
--
-- 원인: 20260717000006에서 teams의 "read" 정책을 지웠다(참가 코드 비공개).
--       team_equity는 security invoker(기본)라 anon 권한으로 teams를 읽다가 RLS에 막혔다.
--       advance_round는 security definer라 그 안에서 호출될 땐 소유자 권한으로 통과했다.
--
-- 해결: team_equity·current_price를 security definer로 바꾼다.
--       둘 다 '읽어서 계산만' 하는 함수라 정의자 권한으로 도는 데 문제가 없다.
--       리더보드(§4)도 이 함수를 쓰게 되므로 직접 호출이 되어야 한다.

create or replace function current_price(p_stock_id text)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((s.prices ->> (g.round_year_map ->> g.current_round::text))::bigint, 0)
  from stocks s
  cross join game_state g
  where s.id = p_stock_id and g.id = 1;
$$;

create or replace function team_equity(p_team_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select t.cash + coalesce((
    select sum(p.quantity::bigint * current_price(p.stock_id))
    from positions p
    where p.team_id = t.id
  ), 0)::bigint
  from teams t
  where t.id = p_team_id;
$$;

-- 예수금만 따로. 리더보드·주문서 화면이 평가금액과 함께 쓴다.
-- teams 직접 조회가 막혀 있으므로 이 통로가 필요하다.
create or replace function team_cash(p_team_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select cash from teams where id = p_team_id;
$$;

grant execute on function current_price(text) to anon, authenticated;
grant execute on function team_equity(uuid) to anon, authenticated;
grant execute on function team_cash(uuid) to anon, authenticated;
