-- 리더보드 동률 정렬을 결정론적으로 — 같은 평가금액이면 조 생성순(created_at)으로 고정.
-- rank()는 그대로라 동률은 같은 순위(같은 숫자)로 나오되, 표시 순서만 안정된다.
create or replace function leaderboard()
returns table (
  rank bigint,
  team_id uuid,
  name text,
  equity bigint,
  pnl bigint,
  pnl_pct numeric,
  prev_rank bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with cur as (
    select t.id, t.name, t.seed, t.created_at, team_equity(t.id) as eq from teams t
  ),
  ranked as (
    select id, name, seed, created_at, eq,
           rank() over (order by eq desc) as rk
    from cur
  ),
  prev as (
    select rs.team_id, rank() over (order by rs.equity desc) as rk
    from round_snapshots rs
    where rs.round = (select greatest(current_round - 1, 0) from game_state where id = 1)
  )
  select r.rk, r.id, r.name, r.eq,
         (r.eq - r.seed)::bigint,
         case when r.seed > 0 then round(((r.eq - r.seed)::numeric / r.seed) * 100, 2) else 0 end,
         p.rk
  from ranked r
  left join prev p on p.team_id = r.id
  order by r.rk, r.created_at; -- 동률 → 조 생성순
$$;
grant execute on function leaderboard() to anon, authenticated;
