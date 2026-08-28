-- 자율 입장(open) 모드 — 닉네임 + PIN으로 학생이 직접 조를 만들고 재접속한다.
-- 관리자가 게임 설정에서 'code'(기존 코드 방식) / 'open'(자율 입장) 중 고른다. 기본은 code.
--   · 새 조는 시작 전(R0)에만. 기존 조 재접속(닉네임+PIN)은 진행 중에도 허용.
--   · 같은 기기는 localStorage에 저장된 code로 자동 재접속(PIN 불필요) — login_team 그대로 사용.

alter table game_state add column if not exists join_mode text not null default 'code';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'game_state_join_mode_chk') then
    alter table game_state add constraint game_state_join_mode_chk check (join_mode in ('code', 'open'));
  end if;
end $$;

alter table teams add column if not exists pin text;

-- ── 게임 설정에 join_mode 추가 (옛 시그니처 drop → 오버로드로 무방비 버전이 남는 걸 방지)
drop function if exists admin_update_game_config(text, int, jsonb, int, bigint, int);
create or replace function admin_update_game_config(
  p_admin_secret text, p_total_rounds int, p_round_year_map jsonb,
  p_final_year int, p_default_seed bigint, p_duration_minutes int, p_join_mode text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_cur int;
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  select current_round into v_cur from game_state where id = 1 for update;
  if v_cur > 0 then
    return jsonb_build_object('ok', false, 'error', 'game_already_started');
  end if;
  if p_join_mode is not null and p_join_mode not in ('code', 'open') then
    return jsonb_build_object('ok', false, 'error', 'bad_join_mode');
  end if;
  update game_state set
    total_rounds = coalesce(p_total_rounds, total_rounds),
    round_year_map = coalesce(p_round_year_map, round_year_map),
    final_year = coalesce(p_final_year, final_year),
    default_seed = coalesce(p_default_seed, default_seed),
    round_duration_seconds = coalesce(p_duration_minutes * 60, round_duration_seconds),
    join_mode = coalesce(p_join_mode, join_mode)
  where id = 1;
  perform emit_signal('stocks_changed', jsonb_build_object('config', true));
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function admin_update_game_config(text, int, jsonb, int, bigint, int, text) to anon, authenticated;

-- ── 자율 입장: 닉네임(+PIN)으로 조 생성/재접속
create or replace function join_team(p_name text, p_pin text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text; v_round int; v_seed bigint;
  v_name text := btrim(p_name);
  v_team teams%rowtype;
  v_pin text;
begin
  select join_mode, current_round, default_seed into v_mode, v_round, v_seed from game_state where id = 1;
  if coalesce(v_mode, 'code') <> 'open' then
    return jsonb_build_object('ok', false, 'error', 'join_disabled');
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 12 then
    return jsonb_build_object('ok', false, 'error', 'bad_name');
  end if;

  -- 닉네임으로 기존 조 찾기(대소문자 무시) → 재접속
  select * into v_team from teams where lower(name) = lower(v_name) limit 1;
  if found then
    if p_pin is null then
      return jsonb_build_object('ok', false, 'error', 'need_pin');
    end if;
    if v_team.pin is distinct from p_pin then
      return jsonb_build_object('ok', false, 'error', 'wrong_pin');
    end if;
    update teams set last_login_at = now() where id = v_team.id;
    perform emit_signal('teams_changed', jsonb_build_object('rejoin', v_team.code)); -- 관리자 조 관리 실시간 갱신
    return jsonb_build_object('ok', true, 'team_id', v_team.id, 'code', v_team.code, 'name', v_team.name);
  end if;

  -- 새 조 = 시작 전(R0)에만
  if v_round <> 0 then
    return jsonb_build_object('ok', false, 'error', 'join_closed');
  end if;
  v_pin := lpad((floor(random() * 10000))::int::text, 4, '0');
  insert into teams (code, name, seed, cash, pin, last_login_at)
    values ('OPEN-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6)),
            v_name, v_seed, v_seed, v_pin, now())
    returning * into v_team;
  perform emit_signal('teams_changed', jsonb_build_object('new', v_team.code)); -- 관리자 화면에 새 조 즉시 표시
  return jsonb_build_object('ok', true, 'team_id', v_team.id, 'code', v_team.code,
                            'name', v_team.name, 'pin', v_pin, 'created', true);
end;
$$;
grant execute on function join_team(text, text) to anon, authenticated;

-- ── admin_teams_status: PIN 함께 반환 (강사가 잊은 학생 도와주기 / 자율 모드에서만 의미)
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
      'last_login_at', t.last_login_at,
      'pin', t.pin
    ) as x
    from teams t
  ) s;

  return jsonb_build_object('ok', true, 'round', v_round, 'teams', v_rows);
end;
$$;
grant execute on function admin_teams_status(text) to anon, authenticated;
