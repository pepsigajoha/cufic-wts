-- admin_teams_status에 참가자별 누적 매매 통계를 얹는다(관리자 통계 탭·실시간 모니터링용).
-- 시그니처 그대로 → create or replace, 기존 키 전부 유지하고 키만 추가한다(오버로드/드롭 없음).
--   trades_total  전체 라운드 누적 체결 건수
--   buy_count / sell_count  매수·매도 건수
--   volume        누적 거래대금 Σ(price*quantity)
--   realized_pnl  실현손익 Σ(coalesce(realized_pnl,0)) — 매도 시 확정분
--   holdings_count 현재 보유 종목 수(수량>0)

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
      'trades_total', (select count(*) from trades tr where tr.team_id = t.id),
      'buy_count', (select count(*) from trades tr where tr.team_id = t.id and tr.side = 'buy'),
      'sell_count', (select count(*) from trades tr where tr.team_id = t.id and tr.side = 'sell'),
      'volume', (select coalesce(sum(tr.price::bigint * tr.quantity), 0) from trades tr where tr.team_id = t.id),
      'realized_pnl', (select coalesce(sum(coalesce(tr.realized_pnl, 0)), 0) from trades tr where tr.team_id = t.id),
      'holdings_count', (select count(*) from positions p where p.team_id = t.id and p.quantity > 0),
      'hint_count', (select count(*) from hint_grants hg where hg.team_id = t.id),
      'last_login_at', t.last_login_at
    ) as x
    from teams t
  ) s;

  return jsonb_build_object('ok', true, 'round', v_round, 'teams', v_rows, 'game_pin', v_game_pin);
end;
$$;
grant execute on function admin_teams_status(text) to anon, authenticated;
