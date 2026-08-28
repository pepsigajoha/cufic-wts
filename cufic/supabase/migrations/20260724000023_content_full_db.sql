-- 콘텐츠 전면 DB 이관 (PART 1: DB·RPC).
--   ⓐ 재무·시황 학생 조회를 라운드 연도까지만 반환하는 RPC로 바꾸고 공개 read 정책 제거(스포일러 차단)
--   ⓑ admin_upsert_stock에 sector·listed_from_round 추가
--   ⓒ 게임 설정 편집 RPC (시작 전에만)

-- ─────────────────────────────────────────────
-- ⓐ 스포일러 차단: 재무·시황을 REST로 직접 못 긁게 하고, RPC가 현재 라운드 연도까지만 준다.
-- ─────────────────────────────────────────────
drop policy if exists "read financials" on financials;
drop policy if exists "read macro" on macro;

-- 현재 화면에 공개해도 되는 최댓값 연도. R0(시작 전)이면 null → 아무것도 안 준다.
create or replace function public_year()
returns int
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (g.round_year_map ->> g.current_round::text)::int,
    case when g.current_round > g.total_rounds then g.final_year end)
  from game_state g where g.id = 1;
$$;
revoke all on function public_year() from public, anon, authenticated;

create or replace function get_financials()
returns setof financials
language sql stable security definer set search_path = public
as $$
  select f.* from financials f where f.year <= public_year();
$$;
grant execute on function get_financials() to anon, authenticated;

create or replace function get_macro()
returns setof macro
language sql stable security definer set search_path = public
as $$
  select m.* from macro m where m.year <= public_year() order by m.year;
$$;
grant execute on function get_macro() to anon, authenticated;

-- 관리자는 미래 연도까지 전부 봐야 편집한다.
create or replace function admin_list_financials(p_admin_secret text)
returns setof financials
language plpgsql stable security definer set search_path = public
as $$
begin
  if not private.verify_admin(p_admin_secret) then return; end if;
  return query select * from financials;
end;
$$;
grant execute on function admin_list_financials(text) to anon, authenticated;

create or replace function admin_list_macro(p_admin_secret text)
returns setof macro
language plpgsql stable security definer set search_path = public
as $$
begin
  if not private.verify_admin(p_admin_secret) then return; end if;
  return query select * from macro order by year;
end;
$$;
grant execute on function admin_list_macro(text) to anon, authenticated;

-- ─────────────────────────────────────────────
-- ⓑ admin_upsert_stock 확장: sector·listed_from_round 추가 (옛 시그니처 drop)
-- ─────────────────────────────────────────────
drop function if exists admin_upsert_stock(text, text, text, text, jsonb, int);

create or replace function admin_upsert_stock(
  p_admin_secret text, p_id text, p_name text, p_description text,
  p_sector text, p_listed_from_round int, p_prices jsonb, p_display_order int
) returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  insert into stocks (id, name, description, sector, listed_from_round, prices, display_order)
  values (p_id, p_name, coalesce(p_description, ''), coalesce(p_sector, ''),
          coalesce(p_listed_from_round, 1), coalesce(p_prices, '{}'::jsonb), coalesce(p_display_order, 0))
  on conflict (id) do update set
    name = excluded.name, description = excluded.description, sector = excluded.sector,
    listed_from_round = excluded.listed_from_round, prices = excluded.prices,
    display_order = excluded.display_order;
  perform emit_signal('stocks_changed', jsonb_build_object('id', p_id));
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function admin_upsert_stock(text, text, text, text, text, int, jsonb, int) to anon, authenticated;

-- ─────────────────────────────────────────────
-- ⓒ 게임 설정 편집 (시작 전에만). round_year_map·final_year·라운드 수·기본 시드·타이머 분.
-- ─────────────────────────────────────────────
create or replace function admin_update_game_config(
  p_admin_secret text, p_total_rounds int, p_round_year_map jsonb,
  p_final_year int, p_default_seed bigint, p_duration_minutes int
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
  update game_state set
    total_rounds = coalesce(p_total_rounds, total_rounds),
    round_year_map = coalesce(p_round_year_map, round_year_map),
    final_year = coalesce(p_final_year, final_year),
    default_seed = coalesce(p_default_seed, default_seed),
    round_duration_seconds = coalesce(p_duration_minutes * 60, round_duration_seconds)
  where id = 1;
  perform emit_signal('stocks_changed', jsonb_build_object('config', true));
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function admin_update_game_config(text, int, jsonb, int, bigint, int) to anon, authenticated;
