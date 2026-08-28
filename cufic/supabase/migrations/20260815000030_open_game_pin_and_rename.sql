-- 자율 입장: 팀별 PIN → "게임 하나에 공용 PIN 하나"(Kahoot식) + 조 이름 관리자 수정
--
-- 강사가 시작 전 무작위 4자리 PIN을 발급해 학생에게 전달한다. 학생은 닉네임 + 공용 PIN으로
-- 입장/재접속한다(같은 닉네임+PIN이면 그 조로 — 재접속 허용).
--   · 공용 PIN은 private.config('game_pin')에 둔다. game_state는 anon이 select로 읽을 수 있어
--     거기 두면 학생이 REST로 읽어 게이트를 우회한다. private는 REST 경로 자체가 없다(admin_secret과 동일 원리).
--   · signals는 공개 테이블이므로 PIN 값을 신호 payload에 절대 싣지 않는다(플래그만).
--   · 팀별 teams.pin 열은 이제 쓰지 않는다(파괴적 drop 없이 방치 — 스키마 되돌릴 여유 없음).

-- ── 공용 게임 PIN 발급/재발급 (관리자) — 무작위 4자리
create or replace function admin_set_game_pin(p_admin_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_pin text;
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  v_pin := lpad((floor(random() * 10000))::int::text, 4, '0');
  insert into private.config (key, value, updated_at)
  values ('game_pin', v_pin, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform emit_signal('teams_changed', jsonb_build_object('game_pin_set', true)); -- 값은 싣지 않는다
  return jsonb_build_object('ok', true, 'game_pin', v_pin);
end;
$$;
grant execute on function admin_set_game_pin(text) to anon, authenticated;

-- ── 자율 입장: 닉네임 + 공용 게임 PIN (팀별 PIN 폐기)
create or replace function join_team(p_name text, p_pin text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text; v_round int; v_seed bigint; v_game_pin text;
  v_name text := btrim(p_name);
  v_team teams%rowtype;
begin
  select join_mode, current_round, default_seed into v_mode, v_round, v_seed from game_state where id = 1;
  if coalesce(v_mode, 'code') <> 'open' then
    return jsonb_build_object('ok', false, 'error', 'join_disabled');
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 12 then
    return jsonb_build_object('ok', false, 'error', 'bad_name');
  end if;

  -- 공용 게임 PIN 대조 (private.config에 저장 — anon은 읽지 못한다)
  select value into v_game_pin from private.config where key = 'game_pin';
  if v_game_pin is null or v_game_pin = '' then
    return jsonb_build_object('ok', false, 'error', 'no_game_pin');
  end if;
  if p_pin is null or p_pin = '' then
    return jsonb_build_object('ok', false, 'error', 'need_pin');
  end if;
  if p_pin <> v_game_pin then
    return jsonb_build_object('ok', false, 'error', 'wrong_pin');
  end if;

  -- 닉네임으로 기존 조 찾기(대소문자 무시) → 재접속
  select * into v_team from teams where lower(name) = lower(v_name) limit 1;
  if found then
    update teams set last_login_at = now() where id = v_team.id;
    perform emit_signal('teams_changed', jsonb_build_object('rejoin', v_team.code)); -- 관리자 조 관리 실시간 갱신
    return jsonb_build_object('ok', true, 'team_id', v_team.id, 'code', v_team.code, 'name', v_team.name);
  end if;

  -- 새 조 = 시작 전(R0)에만
  if v_round <> 0 then
    return jsonb_build_object('ok', false, 'error', 'join_closed');
  end if;
  insert into teams (code, name, seed, cash, last_login_at)
    values ('OPEN-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6)),
            v_name, v_seed, v_seed, now())
    returning * into v_team;
  perform emit_signal('teams_changed', jsonb_build_object('new', v_team.code)); -- 관리자 화면에 새 조 즉시 표시
  return jsonb_build_object('ok', true, 'team_id', v_team.id, 'code', v_team.code,
                            'name', v_team.name, 'created', true);
end;
$$;
grant execute on function join_team(text, text) to anon, authenticated;

-- ── 조 이름 수정 (관리자) — 부적절 닉네임 교정. 닉네임 규칙(2~12자·중복 불가)은 join_team과 동일하게.
create or replace function admin_rename_team(p_admin_secret text, p_code text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(p_name);
  v_code text := upper(trim(p_code));
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 12 then
    return jsonb_build_object('ok', false, 'error', 'bad_name');
  end if;
  if exists (select 1 from teams where lower(name) = lower(v_name) and code <> v_code) then
    return jsonb_build_object('ok', false, 'error', 'name_exists');
  end if;
  update teams set name = v_name where code = v_code;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'team_not_found');
  end if;
  perform emit_signal('teams_changed', jsonb_build_object('rename', v_code));
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function admin_rename_team(text, text, text) to anon, authenticated;

-- ── admin_teams_status: 공용 게임 PIN 함께 반환(관리자 전용). 팀별 pin은 더 이상 반환하지 않는다.
create or replace function admin_teams_status(p_admin_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round int;
  v_rows jsonb;
  v_game_pin text;
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  select current_round into v_round from game_state where id = 1;
  select value into v_game_pin from private.config where key = 'game_pin';

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

  return jsonb_build_object('ok', true, 'round', v_round, 'teams', v_rows, 'game_pin', v_game_pin);
end;
$$;
grant execute on function admin_teams_status(text) to anon, authenticated;
