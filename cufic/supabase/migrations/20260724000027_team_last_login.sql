-- 조 접속 추적: 관리자 [조 관리]에서 "다 들어왔나"를 보게, 로그인 시각을 남긴다.
--   · teams.last_login_at — login_team 성공 시 갱신.
--   · admin_teams_status가 그 값을 함께 반환.

alter table teams add column if not exists last_login_at timestamptz;

-- login_team: 성공 시 접속 시각 기록 (나머지 동작 동일)
create or replace function login_team(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team teams%rowtype;
begin
  select * into v_team from teams where code = upper(trim(p_code));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unknown_code');
  end if;
  update teams set last_login_at = now() where id = v_team.id;
  return jsonb_build_object('ok', true, 'team_id', v_team.id,
                            'code', v_team.code, 'name', v_team.name);
end;
$$;
grant execute on function login_team(text) to anon, authenticated;

-- admin_teams_status: last_login_at 추가
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
      'trades_this_round', (select count(*) from trades tr where tr.team_id = t.id and tr.round = v_round),
      'hint_count', (select count(*) from hint_grants hg where hg.team_id = t.id),
      'last_login_at', t.last_login_at
    ) as x
    from teams t
  ) s;

  return jsonb_build_object('ok', true, 'round', v_round, 'teams', v_rows);
end;
$$;
grant execute on function admin_teams_status(text) to anon, authenticated;
