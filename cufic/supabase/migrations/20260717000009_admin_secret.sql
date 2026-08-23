-- 관리자 RPC 보호 — anon이 게임을 날릴 수 있던 구멍을 막는다
--
-- 문제: advance_round()·reset_game()·grant_hint()가 anon에게 열려 있었다.
--       학생이 브라우저 콘솔에서 reset_game()만 쳐도 대회가 끝난다.
--
-- 설계:
--   * 비밀은 private 스키마에 둔다. Supabase는 PostgREST에 public(+graphql_public)만
--     노출하므로 private.config는 REST로 접근할 경로 자체가 없다.
--     설정 테이블을 public에 두면 anon이 select로 읽어 무의미해진다.
--   * 관리자 RPC는 p_admin_secret을 필수로 받고, 틀리면 'unauthorized'를 돌려준다.
--   * 옛 시그니처는 반드시 drop한다. create or replace로 파라미터만 추가하면
--     오버로드가 생겨 무방비 버전이 그대로 남는다 — 막았다고 착각하기 쉬운 함정.
--   * 비밀이 설정되지 않으면 전부 거부한다(fail closed). 새 DB에 마이그레이션만
--     적용하면 관리자 기능이 잠긴 상태로 시작하고, 아래 부트스트랩으로 연다.
--
-- 부트스트랩 (비밀은 git에 남기지 않는다 — 마이그레이션에 값을 쓰지 말 것):
--   select private.set_admin_secret('원하는_비밀');
--   → Supabase SQL Editor나 Management API로 한 번만 실행. .env의 VITE_ADMIN_PASSWORD와 맞춘다.

create schema if not exists private;

-- anon·authenticated는 이 스키마를 아예 볼 수 없다
revoke all on schema private from public;
revoke usage on schema private from anon, authenticated;

create table if not exists private.config (
  key text primary key,
  value text not null,
  updated_at timestamptz default now()
);

revoke all on private.config from public, anon, authenticated;

-- 비밀 설정. anon에게 execute를 주지 않는다 — SQL Editor/Management API로만 호출된다.
create or replace function private.set_admin_secret(p_secret text)
returns void
language sql
as $$
  insert into private.config (key, value, updated_at)
  values ('admin_secret', p_secret, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
$$;

revoke all on function private.set_admin_secret(text) from public, anon, authenticated;

-- 검증기. security definer라 관리자 RPC 안에서만 쓰이고, anon에게 직접 노출하지 않는다.
-- (노출하면 비밀을 무차별 대입해볼 통로가 된다)
create or replace function private.verify_admin(p_secret text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select value into v_secret from private.config where key = 'admin_secret';
  -- 설정 전이면 전부 거부. 열린 채로 시작하지 않는다.
  if v_secret is null or v_secret = '' then
    return false;
  end if;
  return p_secret is not null and p_secret = v_secret;
end;
$$;

revoke all on function private.verify_admin(text) from public, anon, authenticated;

-- ─────────────────────────────────────────────
-- 옛 무방비 시그니처 제거 (오버로드로 남으면 막은 게 아니다)
-- ─────────────────────────────────────────────
drop function if exists advance_round();
drop function if exists reset_game();
drop function if exists grant_hint(bigint, text);
drop function if exists revoke_hint(bigint, text);

-- ─────────────────────────────────────────────
-- 라운드 진행 (관리자)
-- ─────────────────────────────────────────────
create or replace function advance_round(p_admin_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cur int;
  v_total int;
  r record;
  v_pos positions%rowtype;
  v_amount bigint;
  v_new_qty int;
  v_new_avg numeric;
  v_realized bigint;
  v_fills int := 0;
  v_skipped jsonb := '[]'::jsonb;
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  select current_round, total_rounds into v_cur, v_total from game_state where id = 1 for update;

  if v_cur >= v_total then
    return jsonb_build_object('ok', false, 'error', 'already_last_round');
  end if;

  if v_cur < 1 then
    update game_state set current_round = 1 where id = 1;
    return jsonb_build_object('ok', true, 'current_round', 1, 'fills', 0);
  end if;

  update game_state set is_locked = true where id = 1;

  -- 안전망: 저장 이후 관리자가 가격을 고쳤다면 자금이 모자랄 수 있다.
  -- 그런 조는 매수를 통째로 건너뛰고 기록에 남긴다 (매도는 현금이 늘기만 하므로 체결).
  for r in
    select t.id as team_id, t.code, t.cash,
           coalesce(sum(os.buy_qty::bigint * current_price(os.stock_id)), 0)::bigint as buy_cost,
           coalesce(sum(os.sell_qty::bigint * current_price(os.stock_id)), 0)::bigint as sell_proceeds
    from teams t
    join order_sheets os on os.team_id = t.id and os.round = v_cur
    group by t.id, t.code, t.cash
  loop
    if not order_funds_ok(r.cash, r.buy_cost, r.sell_proceeds) then
      delete from order_sheets where team_id = r.team_id and round = v_cur and buy_qty > 0;
      v_skipped := v_skipped || jsonb_build_object('team_code', r.code, 'reason', 'insufficient_cash');
    end if;
  end loop;

  -- 매도 먼저 (매도 대금을 매수 자금으로 인정하는 규칙과 일관)
  for r in
    select os.team_id, os.stock_id, os.sell_qty, current_price(os.stock_id) as price
    from order_sheets os
    where os.round = v_cur and os.sell_qty > 0
    order by os.team_id, os.stock_id
  loop
    select * into v_pos from positions
    where team_id = r.team_id and stock_id = r.stock_id for update;
    if not found or v_pos.quantity < r.sell_qty or r.price <= 0 then
      continue;
    end if;

    v_amount := r.price * r.sell_qty;
    v_realized := round((r.price - v_pos.avg_price) * r.sell_qty);
    v_new_qty := v_pos.quantity - r.sell_qty;

    if v_new_qty = 0 then
      delete from positions where team_id = r.team_id and stock_id = r.stock_id;
    else
      update positions set quantity = v_new_qty
      where team_id = r.team_id and stock_id = r.stock_id;
    end if;

    update teams set cash = cash + v_amount where id = r.team_id;
    insert into trades (team_id, stock_id, side, price, quantity, round, realized_pnl)
    values (r.team_id, r.stock_id, 'sell', r.price, r.sell_qty, v_cur, v_realized);
    v_fills := v_fills + 1;
  end loop;

  -- 그다음 매수
  for r in
    select os.team_id, os.stock_id, os.buy_qty, current_price(os.stock_id) as price
    from order_sheets os
    where os.round = v_cur and os.buy_qty > 0
    order by os.team_id, os.stock_id
  loop
    if r.price <= 0 then
      continue;
    end if;
    v_amount := r.price * r.buy_qty;

    select * into v_pos from positions
    where team_id = r.team_id and stock_id = r.stock_id for update;

    if found then
      v_new_qty := v_pos.quantity + r.buy_qty;
      v_new_avg := round((v_pos.quantity * v_pos.avg_price + v_amount) / v_new_qty);
      update positions set quantity = v_new_qty, avg_price = v_new_avg
      where team_id = r.team_id and stock_id = r.stock_id;
    else
      insert into positions (team_id, stock_id, quantity, avg_price)
      values (r.team_id, r.stock_id, r.buy_qty, r.price);
    end if;

    update teams set cash = cash - v_amount where id = r.team_id;
    insert into trades (team_id, stock_id, side, price, quantity, round, realized_pnl)
    values (r.team_id, r.stock_id, 'buy', r.price, r.buy_qty, v_cur, null);
    v_fills := v_fills + 1;
  end loop;

  delete from order_sheets where round = v_cur;

  -- 스냅샷: 체결 반영 후 · 새 가격 적용 전
  insert into round_snapshots (team_id, round, equity)
  select t.id, v_cur, team_equity(t.id) from teams t
  on conflict (team_id, round) do update set equity = excluded.equity;

  update game_state set current_round = v_cur + 1, is_locked = false where id = 1;

  return jsonb_build_object('ok', true, 'current_round', v_cur + 1,
                            'fills', v_fills, 'skipped', v_skipped);
end;
$$;

-- ─────────────────────────────────────────────
-- 게임 초기화 (관리자)
-- ─────────────────────────────────────────────
create or replace function reset_game(p_admin_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  update game_state set is_locked = true where id = 1;

  -- where true = 전체를 지우는 게 맞다는 명시 (Supabase safeupdate 가드)
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

-- ─────────────────────────────────────────────
-- 힌트 지급·취소 (관리자)
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

  select id into v_team_id from teams where code = p_team_code;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'team_not_found');
  end if;
  if not exists (select 1 from hints where id = p_hint_id) then
    return jsonb_build_object('ok', false, 'error', 'hint_not_found');
  end if;

  insert into hint_grants (hint_id, team_id) values (p_hint_id, v_team_id)
  on conflict (hint_id, team_id) do nothing;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function revoke_hint(p_hint_id bigint, p_team_code text, p_admin_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  delete from hint_grants hg
  using teams t
  where hg.team_id = t.id and t.code = p_team_code and hg.hint_id = p_hint_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- ─────────────────────────────────────────────
-- 관리자 로그인 확인 — §4 화면이 비밀번호를 검사할 때 쓴다.
-- 맞는지 여부만 돌려주고 비밀 자체는 절대 내보내지 않는다.
-- ─────────────────────────────────────────────
create or replace function admin_login(p_admin_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function advance_round(text) to anon, authenticated;
grant execute on function reset_game(text) to anon, authenticated;
grant execute on function grant_hint(bigint, text, text) to anon, authenticated;
grant execute on function revoke_hint(bigint, text, text) to anon, authenticated;
grant execute on function admin_login(text) to anon, authenticated;
