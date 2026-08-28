-- §4 관리자 RPC + 리더보드 + §5 실시간 신호
--
-- [잠정] 실시간 방식: signals 테이블 + Realtime 구독
--   힌트는 조별로 격리돼 있어(select 정책 없음) Realtime Postgres Changes로 못 받는다.
--   Realtime은 RLS를 쓰는데 anon은 hint_grants를 볼 수 없기 때문.
--   그래서 "무엇이 바뀌었다"만 알리는 signals 테이블을 두고, 클라이언트는 신호를 받으면
--   자기 데이터를 RPC로 다시 가져온다. 신호 자체엔 비밀이 없으므로 공개해도 안전하다.
--   ("3단계 지시서의 신호 방식"을 받지 못해 이렇게 설계함. 문서 확인 후 조정 가능)

-- ─────────────────────────────────────────────
-- 실시간 신호
-- ─────────────────────────────────────────────
create table signals (
  id bigint generated always as identity primary key,
  kind text not null,          -- round_advanced | game_reset | hints_changed | stocks_changed | teams_changed | game_ended
  payload jsonb not null default '{}',
  created_at timestamptz default now()
);

alter table signals enable row level security;
create policy "read signals" on signals for select using (true);

alter publication supabase_realtime add table signals;

create or replace function emit_signal(p_kind text, p_payload jsonb default '{}')
returns void
language sql
security definer
set search_path = public
as $$
  insert into signals (kind, payload) values (p_kind, p_payload);
$$;

revoke all on function emit_signal(text, jsonb) from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 리더보드 (공개) — 정산 시점에만 바뀐다
-- ─────────────────────────────────────────────
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
    select t.id, t.name, t.seed, team_equity(t.id) as eq from teams t
  ),
  ranked as (
    select id, name, seed, eq,
           rank() over (order by eq desc) as rk
    from cur
  ),
  prev as (
    -- 직전 라운드 스냅샷 기준 순위 (등락 표시용)
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
  order by r.rk;
$$;

grant execute on function leaderboard() to anon, authenticated;

-- ─────────────────────────────────────────────
-- 관리자: 조별 현황 (예수금·평가금액·주문서 제출 여부)
-- ─────────────────────────────────────────────
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
      -- 어느 조가 아직 주문서를 안 냈는지 보여준다
      'sheet_lines', (select count(*) from order_sheets os where os.team_id = t.id and os.round = v_round),
      'hint_count', (select count(*) from hint_grants hg where hg.team_id = t.id)
    ) as x
    from teams t
  ) s;

  return jsonb_build_object('ok', true, 'round', v_round, 'teams', v_rows);
end;
$$;

-- ─────────────────────────────────────────────
-- 관리자: 조 관리
-- ─────────────────────────────────────────────
create or replace function admin_create_team(p_admin_secret text, p_code text, p_name text, p_seed bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(trim(p_code));
  v_seed bigint := p_seed;
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  if v_code = '' or v_code is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;
  if exists (select 1 from teams where code = v_code) then
    return jsonb_build_object('ok', false, 'error', 'code_exists');
  end if;
  if v_seed is null or v_seed <= 0 then
    select default_seed into v_seed from game_state where id = 1;
  end if;

  insert into teams (code, name, seed, cash)
  values (v_code, coalesce(nullif(trim(p_name), ''), v_code), v_seed, v_seed);

  perform emit_signal('teams_changed', jsonb_build_object('code', v_code));
  return jsonb_build_object('ok', true, 'code', v_code);
end;
$$;

create or replace function admin_delete_team(p_admin_secret text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  delete from teams where code = upper(trim(p_code));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'team_not_found');
  end if;
  perform emit_signal('teams_changed', jsonb_build_object('deleted', p_code));
  return jsonb_build_object('ok', true);
end;
$$;

-- 시드는 시작 전에만 바꿀 수 있다. 진행 중 바꾸면 이미 체결된 거래와 손익이 어긋난다.
create or replace function admin_set_team_seed(p_admin_secret text, p_code text, p_seed bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round int;
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  select current_round into v_round from game_state where id = 1;
  if v_round > 0 then
    return jsonb_build_object('ok', false, 'error', 'game_already_started');
  end if;
  if p_seed is null or p_seed <= 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_seed');
  end if;

  update teams set seed = p_seed, cash = p_seed where code = upper(trim(p_code));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'team_not_found');
  end if;
  perform emit_signal('teams_changed', jsonb_build_object('code', p_code));
  return jsonb_build_object('ok', true);
end;
$$;

-- ─────────────────────────────────────────────
-- 관리자: 힌트 풀 관리
-- ─────────────────────────────────────────────
create or replace function admin_list_hints(p_admin_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  select coalesce(jsonb_agg(x order by (x ->> 'round')::int, x ->> 'grade', (x ->> 'id')::bigint), '[]'::jsonb)
  into v
  from (
    select jsonb_build_object(
      'id', h.id, 'round', h.round, 'grade', h.grade,
      'headline', h.headline, 'impact', h.impact,
      'related_stock_ids', h.related_stock_ids,
      'granted_to', coalesce((
        select jsonb_agg(t.code order by t.code)
        from hint_grants hg join teams t on t.id = hg.team_id
        where hg.hint_id = h.id
      ), '[]'::jsonb)
    ) as x
    from hints h
  ) s;

  return jsonb_build_object('ok', true, 'hints', v);
end;
$$;

create or replace function admin_upsert_hint(
  p_admin_secret text,
  p_id bigint,
  p_round int,
  p_grade text,
  p_headline text,
  p_impact text,
  p_related text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_bad text[];
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  if p_grade not in ('S','A','B','C','D') then
    return jsonb_build_object('ok', false, 'error', 'invalid_grade');
  end if;
  if p_impact not in ('up','down','flat') then
    return jsonb_build_object('ok', false, 'error', 'invalid_impact');
  end if;
  if coalesce(trim(p_headline), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'empty_headline');
  end if;

  -- 관련 종목은 실존해야 한다. 없는 종목을 가리키면 학생에게 살 수 없는 걸 사라고 하는 꼴.
  select array_agg(s) into v_bad
  from unnest(coalesce(p_related, '{}')) s
  where not exists (select 1 from stocks where id = s);
  if v_bad is not null then
    return jsonb_build_object('ok', false, 'error', 'unknown_stock', 'stock_ids', v_bad);
  end if;

  if p_id is null then
    insert into hints (round, grade, headline, impact, related_stock_ids)
    values (p_round, p_grade, trim(p_headline), p_impact, coalesce(p_related, '{}'))
    returning id into v_id;
  else
    update hints set round = p_round, grade = p_grade, headline = trim(p_headline),
                     impact = p_impact, related_stock_ids = coalesce(p_related, '{}')
    where id = p_id
    returning id into v_id;
    if v_id is null then
      return jsonb_build_object('ok', false, 'error', 'hint_not_found');
    end if;
  end if;

  perform emit_signal('hints_changed', jsonb_build_object('hint_id', v_id));
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function admin_delete_hint(p_admin_secret text, p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  delete from hints where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'hint_not_found');
  end if;
  perform emit_signal('hints_changed', jsonb_build_object('deleted', p_id));
  return jsonb_build_object('ok', true);
end;
$$;

-- 여러 조에 한꺼번에 지급 (배분 제안을 강사가 확인하고 확정할 때 쓴다)
create or replace function admin_grant_hints(p_admin_secret text, p_grants jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g jsonb;
  v_team_id uuid;
  v_count int := 0;
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  for g in select * from jsonb_array_elements(p_grants) loop
    select id into v_team_id from teams where code = upper(trim(g ->> 'team_code'));
    if v_team_id is null then continue; end if;
    if not exists (select 1 from hints where id = (g ->> 'hint_id')::bigint) then continue; end if;

    insert into hint_grants (hint_id, team_id) values ((g ->> 'hint_id')::bigint, v_team_id)
    on conflict (hint_id, team_id) do nothing;
    v_count := v_count + 1;
  end loop;

  perform emit_signal('hints_changed', jsonb_build_object('granted', v_count));
  return jsonb_build_object('ok', true, 'granted', v_count);
end;
$$;

-- ─────────────────────────────────────────────
-- 관리자: 종목·가격
-- ─────────────────────────────────────────────
create or replace function admin_upsert_stock(
  p_admin_secret text,
  p_id text,
  p_name text,
  p_description text,
  p_prices jsonb,
  p_display_order int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  if coalesce(trim(p_id), '') = '' or coalesce(trim(p_name), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;

  insert into stocks (id, name, description, prices, display_order)
  values (trim(p_id), trim(p_name), coalesce(p_description, ''), coalesce(p_prices, '{}'::jsonb),
          coalesce(p_display_order, 0))
  on conflict (id) do update
    set name = excluded.name, description = excluded.description,
        prices = excluded.prices, display_order = excluded.display_order;

  perform emit_signal('stocks_changed', jsonb_build_object('stock_id', p_id));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function admin_delete_stock(p_admin_secret text, p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  delete from stocks where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'stock_not_found');
  end if;
  perform emit_signal('stocks_changed', jsonb_build_object('deleted', p_id));
  return jsonb_build_object('ok', true);
end;
$$;

-- ─────────────────────────────────────────────
-- 관리자: 대회 종료 — 마지막 라운드 스냅샷을 남긴다
-- ─────────────────────────────────────────────
create or replace function admin_end_game(p_admin_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cur int;
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  select current_round into v_cur from game_state where id = 1;
  if v_cur < 1 then
    return jsonb_build_object('ok', false, 'error', 'game_not_started');
  end if;

  update game_state set is_locked = true where id = 1;
  insert into round_snapshots (team_id, round, equity)
  select t.id, v_cur, team_equity(t.id) from teams t
  on conflict (team_id, round) do update set equity = excluded.equity;

  perform emit_signal('game_ended', jsonb_build_object('round', v_cur));
  return jsonb_build_object('ok', true, 'round', v_cur);
end;
$$;

-- ─────────────────────────────────────────────
-- 기존 관리자 RPC에 신호 발행 추가
-- ─────────────────────────────────────────────
create or replace function grant_hint(p_hint_id bigint, p_team_code text, p_admin_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  select id into v_team_id from teams where code = upper(trim(p_team_code));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'team_not_found');
  end if;
  if not exists (select 1 from hints where id = p_hint_id) then
    return jsonb_build_object('ok', false, 'error', 'hint_not_found');
  end if;

  insert into hint_grants (hint_id, team_id) values (p_hint_id, v_team_id)
  on conflict (hint_id, team_id) do nothing;

  perform emit_signal('hints_changed', jsonb_build_object('hint_id', p_hint_id));
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function admin_teams_status(text) to anon, authenticated;
grant execute on function admin_create_team(text, text, text, bigint) to anon, authenticated;
grant execute on function admin_delete_team(text, text) to anon, authenticated;
grant execute on function admin_set_team_seed(text, text, bigint) to anon, authenticated;
grant execute on function admin_list_hints(text) to anon, authenticated;
grant execute on function admin_upsert_hint(text, bigint, int, text, text, text, text[]) to anon, authenticated;
grant execute on function admin_delete_hint(text, bigint) to anon, authenticated;
grant execute on function admin_grant_hints(text, jsonb) to anon, authenticated;
grant execute on function admin_upsert_stock(text, text, text, text, jsonb, int) to anon, authenticated;
grant execute on function admin_delete_stock(text, text) to anon, authenticated;
grant execute on function admin_end_game(text) to anon, authenticated;
