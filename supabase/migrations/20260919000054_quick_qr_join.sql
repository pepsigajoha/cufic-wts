-- QR 간편 입장 — 링크를 연 학생마다 서버가 랜덤 이름의 1인 조를 만든다.
-- 관리자가 켠 동안 + 대회 시작 전(R0)에만 신규 생성한다.

alter table game_state
  add column if not exists quick_join_enabled boolean not null default false;

comment on column game_state.quick_join_enabled is
  'true면 QR 간편 입장 허용. 신규 1인 조 생성은 current_round=0에서만 가능';

create or replace function admin_set_quick_join(
  p_admin_secret text,
  p_enabled boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  if p_enabled is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_value');
  end if;

  update game_state set quick_join_enabled = p_enabled where id = 1;
  perform emit_signal('teams_changed', jsonb_build_object('quick_join_enabled', p_enabled));
  return jsonb_build_object('ok', true, 'quick_join_enabled', p_enabled);
end;
$$;

grant execute on function admin_set_quick_join(text, boolean) to anon, authenticated;

create or replace function quick_join_team()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
  v_round int;
  v_seed bigint;
  v_code text;
  v_name text;
  v_team teams%rowtype;
  v_try int;
  v_adjectives text[] := array[
    '용감한', '빛나는', '빠른', '든든한', '행운의',
    '똑똑한', '침착한', '힘찬', '멋진', '푸른'
  ];
  v_nouns text[] := array[
    '호랑이', '돌고래', '독수리', '여우', '사자',
    '펭귄', '수달', '판다', '매', '거북이'
  ];
begin
  -- 한 번에 여러 명이 찍어도 이름 중복이 나지 않게 생성 구간만 직렬화한다.
  select quick_join_enabled, current_round, default_seed
    into v_enabled, v_round, v_seed
  from game_state where id = 1 for update;

  if not coalesce(v_enabled, false) then
    return jsonb_build_object('ok', false, 'error', 'quick_join_disabled');
  end if;
  if v_round <> 0 then
    return jsonb_build_object('ok', false, 'error', 'join_closed');
  end if;

  for v_try in 1..20 loop
    v_code := 'QR-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    v_name :=
      v_adjectives[1 + floor(random() * array_length(v_adjectives, 1))::int] ||
      v_nouns[1 + floor(random() * array_length(v_nouns, 1))::int] ||
      lpad(floor(random() * 100)::int::text, 2, '0');
    exit when not exists (select 1 from teams where code = v_code or lower(name) = lower(v_name));
  end loop;

  if exists (select 1 from teams where code = v_code or lower(name) = lower(v_name)) then
    return jsonb_build_object('ok', false, 'error', 'nickname_unavailable');
  end if;

  insert into teams (code, name, seed, cash, last_login_at)
  values (v_code, v_name, v_seed, v_seed, now())
  returning * into v_team;

  -- signals는 공개 테이블이므로 참가 코드는 싣지 않는다.
  perform emit_signal('teams_changed', jsonb_build_object('quick_join', true));
  return jsonb_build_object(
    'ok', true,
    'team_id', v_team.id,
    'code', v_team.code,
    'name', v_team.name,
    'created', true
  );
end;
$$;

grant execute on function quick_join_team() to anon, authenticated;
