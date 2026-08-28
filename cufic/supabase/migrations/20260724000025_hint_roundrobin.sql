-- 힌트 자동 배분 규칙 교체: 등급 구간 매핑(floor 공식) → 등급순 × 순위 라운드로빈.
--
-- 새 규칙:
--   1. 라운드 힌트 풀을 등급 좋은 순(S→D), 같은 등급은 작성순(id 오름차순)으로 정렬.
--   2. 순위 꼴찌부터 1위 방향으로 한 장씩 라운드로빈, 힌트가 소진될 때까지 반복.
--   → 모든 힌트 지급, 하위권일수록 좋은 힌트 + 더 많은 개수.
--   · 순위 = 평가금액 오름차순(꼴찌 먼저), 동률은 생성순 → id (결정론적).
--   · R1 무지급(호출부에서 R2부터). advance_round가 새 가격 공개 후 호출.
--   힌트 hn(0=가장 좋음) → 팀 rn=(hn % 조수), rn=0이 꼴찌. 그래서 좋은 힌트가 꼴찌부터.

create or replace function distribute_round_hints(p_hint_round int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
  v_granted int := 0;
begin
  if p_hint_round < 2 then
    return jsonb_build_object('granted', 0, 'warnings', '[]'::jsonb);
  end if;

  select count(*) into v_n from teams;
  if v_n = 0 then
    return jsonb_build_object('granted', 0, 'warnings', '[]'::jsonb);
  end if;

  with ranked as (
    select t.id,
           (row_number() over (order by team_equity(t.id) asc, t.created_at asc, t.id asc) - 1) as rn
    from teams t
  ),
  pool as (
    select h.id as hint_id,
           (row_number() over (
              order by case h.grade
                when 'S' then 0 when 'A' then 1 when 'B' then 2 when 'C' then 3 else 4 end asc,
              h.id asc) - 1) as hn
    from hints h
    where h.round = p_hint_round
  ),
  assign as (
    select p.hint_id, r.id as team_id
    from pool p
    join ranked r on r.rn = (p.hn % v_n)
  ),
  ins as (
    insert into hint_grants (hint_id, team_id)
    select hint_id, team_id from assign
    on conflict (hint_id, team_id) do nothing
    returning 1
  )
  select count(*) into v_granted from ins;

  return jsonb_build_object('granted', v_granted, 'warnings', '[]'::jsonb);
end;
$$;

revoke all on function distribute_round_hints(int) from public, anon, authenticated;
