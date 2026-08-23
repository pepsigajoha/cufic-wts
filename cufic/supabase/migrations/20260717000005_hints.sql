-- 뉴스 → 힌트 등급제로 개편
--
-- 규칙: 힌트에 S/A/B/C/D 등급이 있고 강사가 조별로 차등 지급한다
--       (하위권 우대·랜덤·재량 혼합). 배분 판단은 사람이 하고 DB는 "누가 뭘 받았나"만 기록한다.
--       조마다 보이는 힌트가 다르다 — 이게 기존 is_published(전체 공개) 방식과 결정적으로 다르다.

drop table if exists news;

create table hints (
  id bigint generated always as identity primary key,
  round int not null,
  grade text not null check (grade in ('S','A','B','C','D')),
  headline text not null,
  impact text not null check (impact in ('up','down','flat')),
  related_stock_ids text[] not null default '{}',
  created_at timestamptz default now()
);

comment on column hints.grade is 'S가 가장 가치 높은 힌트. 강사가 조별 차등 지급에 쓴다';
comment on column hints.impact is 'up=호재 / down=악재 / flat=중립. 프론트와 동일 용어';

-- 같은 힌트를 여러 조에 줄 수 있다 (복수 행)
create table hint_grants (
  hint_id bigint references hints(id) on delete cascade,
  team_id uuid references teams(id) on delete cascade,
  granted_at timestamptz default now(),
  primary key (hint_id, team_id)
);

create index hint_grants_team_idx on hint_grants (team_id);

alter table hints enable row level security;
alter table hint_grants enable row level security;

-- select 정책을 만들지 않는다 = REST로 힌트 목록을 통째로 긁을 수 없다.
--
-- 인증이 없어(anon key + 참가 코드) RLS가 "자기 조"를 알 방법이 없다.
-- 그래서 지시서의 "자기 조 것만 select"를 select 정책이 아니라
-- 코드를 받는 RPC(get_my_hints)로 구현한다. 결과는 같다 —
-- 지급되지 않은 힌트는 REST를 직접 때려도 안 보인다.

-- ─────────────────────────────────────────────
-- 내 조에 지급된 힌트만
-- ─────────────────────────────────────────────
create or replace function get_my_hints(p_team_code text)
returns table (
  id bigint,
  round int,
  grade text,
  headline text,
  impact text,
  related_stock_ids text[],
  granted_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select h.id, h.round, h.grade, h.headline, h.impact, h.related_stock_ids, hg.granted_at
  from hints h
  join hint_grants hg on hg.hint_id = h.id
  join teams t on t.id = hg.team_id
  where t.code = p_team_code
  order by hg.granted_at desc, h.id desc;
$$;

-- ─────────────────────────────────────────────
-- 힌트 지급 (관리자) — §4에서 비밀번호 검증을 얹는다
-- ─────────────────────────────────────────────
create or replace function grant_hint(p_hint_id bigint, p_team_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
begin
  select id into v_team_id from teams where code = p_team_code;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'team_not_found');
  end if;
  if not exists (select 1 from hints where id = p_hint_id) then
    return jsonb_build_object('ok', false, 'error', 'hint_not_found');
  end if;

  insert into hint_grants (hint_id, team_id) values (p_hint_id, v_team_id)
  on conflict (hint_id, team_id) do nothing; -- 두 번 눌러도 안전

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function revoke_hint(p_hint_id bigint, p_team_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from hint_grants hg
  using teams t
  where hg.team_id = t.id and t.code = p_team_code and hg.hint_id = p_hint_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ─────────────────────────────────────────────
-- reset_game — news → hints 개편 반영
-- ─────────────────────────────────────────────
create or replace function reset_game()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update game_state set is_locked = true where id = 1;

  -- where true = "전체를 지우는 게 맞다"는 명시.
  -- Supabase는 WHERE 없는 DELETE/UPDATE를 safeupdate 가드로 막는다.
  delete from round_snapshots where true;
  delete from trades where true;
  delete from positions where true;
  delete from order_sheets where true;
  delete from hint_grants where true; -- 힌트 자체는 남기고 지급 기록만 지운다
  update teams set cash = seed where true;

  update game_state set current_round = 0, is_locked = false where id = 1;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function get_my_hints(text) to anon, authenticated;
grant execute on function grant_hint(bigint, text) to anon, authenticated;
grant execute on function revoke_hint(bigint, text) to anon, authenticated;
grant execute on function reset_game() to anon, authenticated;
