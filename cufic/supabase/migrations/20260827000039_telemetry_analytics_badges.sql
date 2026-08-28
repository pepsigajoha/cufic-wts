-- Phase 1 / Feature 2 — 행동 텔레메트리 + 투자성향(MBTI)·배지 집계(draft, dev DB 전용 적용 예정).
--
-- 설계 선택:
--   * trades 테이블(체결)과 별개로 UI 상호작용(조회·주문창 열기 등)을 담는 이벤트 로그를 새로 둔다.
--     trades에 섞으면 "체결"이라는 확정적 의미가 흐려지고, 고빈도 UI 이벤트가 재무 테이블을
--     오염시킨다.
--   * "클라이언트 랙 없이"는 서버 설계가 아니라 프론트 통합 방식의 문제다 — log_event RPC를
--     await 없이(fire-and-forget) 호출하게 만들면 된다. 아래 "통합 지점" 참고.

-- ─────────────────────────────────────────────
-- 이벤트 로그 (고빈도, append-only)
-- ─────────────────────────────────────────────
create table game_trade_logs (
  id bigint generated always as identity primary key,
  team_id uuid references teams(id) on delete cascade,
  round int not null,
  event_type text not null check (event_type in (
    'view_stock', 'open_order_panel', 'submit_order', 'broadcast_seen', 'news_seen', 'hedge_executed'
  )),
  stock_id text references stocks(id) on delete set null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index game_trade_logs_team_round_idx on game_trade_logs (team_id, round, created_at);
create index game_trade_logs_type_idx on game_trade_logs (event_type, created_at);

comment on column game_trade_logs.meta is
  'event_type별 자유 형식. submit_order: {"side","qty","price"} / broadcast_seen: {"broadcast_id"} 등.
   submit_order는 실제 체결 여부와 무관하게 "버튼을 눌렀다"는 사실만 기록한다(성공/실패는 trades·
   place_order 응답으로 별도 판단) — FOMO 반응시간 계산엔 클릭 시점 자체가 필요하기 때문.';

comment on constraint game_trade_logs_event_type_check on game_trade_logs is
  'hedge_executed는 "철벽 방어" 배지용 기록 훅일 뿐이다 — 보호적 풋 헷지 자체(옵션/헤지 매매
   메커니즘)는 이 Phase 1에 포함되지 않는다. 그 기능을 실제로 만들 때 log_event(team_code,
   ''hedge_executed'', stock_id, meta)를 호출하도록 연결해야 배지가 실제로 발급된다.';

alter table game_trade_logs enable row level security;
-- select 정책 없음 — 원시 이벤트 로그는 admin 전용(팀 간 상호 관찰로 인한 눈치싸움 방지 목적도 겸함).

create or replace function log_event(
  p_team_code text,
  p_event_type text,
  p_stock_id text default null,
  p_meta jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_round int;
begin
  select id into v_team_id from teams where code = p_team_code;
  if v_team_id is null then
    return jsonb_build_object('ok', false, 'error', 'team_not_found');
  end if;
  select current_round into v_round from game_state where id = 1;

  insert into game_trade_logs (team_id, round, event_type, stock_id, meta)
  values (v_team_id, coalesce(v_round, 0), p_event_type, p_stock_id, coalesce(p_meta, '{}'::jsonb));

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function log_event(text, text, text, jsonb) to anon, authenticated;

-- ─────────────────────────────────────────────
-- 팀별 집계 결과 (게임 종료 후 배치로 계산해 채운다)
-- ─────────────────────────────────────────────
create table game_team_analytics (
  team_id uuid primary key references teams(id) on delete cascade,
  turnover_rate numeric,        -- 총 매매대금 / 평균 평가금액
  hhi numeric,                  -- 포트폴리오 집중도, 0~10000(표준 HHI 스케일: Σ(종목비중%)²)
  mdd numeric,                  -- 최대 낙폭(%), round_snapshots 시계열 기준
  fomo_reaction_ms numeric,     -- broadcast_seen → 그 직후 submit_order까지 평균 반응시간(ms)
  archetype text,               -- '가치투자형'|'단타형'|'분산투자형'|'몰빵형' — 아래 admin_compute_team_analytics 참고
  badges text[] not null default '{}',
  computed_at timestamptz not null default now()
);

alter table game_team_analytics enable row level security;
-- 결과 화면(엔딩 리포트)에서 학생도 봐야 하는 콘텐츠 — 과거 행동 결과라 스포일러 아님. 공개 select.
create policy "read game_team_analytics" on game_team_analytics for select using (true);

-- ─────────────────────────────────────────────
-- 집계 실행 (관리자, 게임 종료 후 1회 또는 재계산용)
--
-- [확정됨]
--  * archetype = 회전율(turnover_rate) × 집중도(HHI) 2축, 우선순위 결정 트리:
--      HHI > 4000(꽤 집중) → 몰빵형 / HHI < 2000(5종목 이상 균등 분산에 해당) → 분산투자형
--      (둘 다 아닌 중간 구간에서만) 회전율 > 1.0 → 단타형 / 아니면 → 가치투자형
--    HHI 극단이 회전율보다 우선한다 — "몰빵/분산" 여부가 더 정체성을 잘 드러낸다고 판단.
--    임계값(4000/2000/1.0)은 조정 가능 — 정해진 데이터 기준이 있다면 바꾼다.
--  * 배지 3종: 존버의 달인(무거래 라운드 3회 이상) / 빛보다 빠른 손(회전율 상위 10%) /
--    철벽 방어(hedge_executed 이벤트 1회 이상 — 단, 그 이벤트를 실제로 발생시키는 보호적 풋
--    헷지 기능 자체는 이 Phase 1에 없다. 위 game_trade_logs 주석 참고).
--  * 배지 카탈로그는 지금처럼 이 함수 본문에 하드코딩 — 관리자 편집 테이블(badge_defs)은
--    요청 없어 만들지 않음(YAGNI, 필요해지면 나중에 분리).
-- ─────────────────────────────────────────────
create or replace function admin_compute_team_analytics(p_admin_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_computed int := 0;
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  with turnover as (
    select tr.team_id, sum(tr.price * tr.quantity) as traded_amount
    from trades tr group by tr.team_id
  ),
  avg_equity as (
    select rs.team_id, avg(rs.equity) as avg_eq
    from round_snapshots rs group by rs.team_id
  ),
  peak_trough as (
    -- MDD: 라운드별 평가금액 시계열에서 그 시점까지의 최고점 대비 낙폭 중 최댓값
    select team_id, max(dd) as mdd from (
      select rs.team_id, rs.round,
             (max(rs.equity) over (partition by rs.team_id order by rs.round) - rs.equity)::numeric
               / nullif(max(rs.equity) over (partition by rs.team_id order by rs.round), 0) * 100 as dd
      from round_snapshots rs
    ) x group by team_id
  ),
  concentration as (
    -- positions엔 현재가가 없다(평단만 저장) — current_price()로 평가액을 다시 계산한다.
    select p.team_id,
           sum(power((p.quantity * current_price(p.stock_id))::numeric / nullif(te.equity, 0) * 100, 2)) as hhi
    from positions p
    cross join lateral (select team_equity(p.team_id) as equity) te
    group by p.team_id
  ),
  fomo as (
    -- broadcast_seen 이후 60초 이내의 첫 submit_order까지 반응시간(ms) 평균
    select b.team_id, avg(extract(epoch from (o.created_at - b.created_at)) * 1000) as reaction_ms
    from game_trade_logs b
    join lateral (
      select created_at from game_trade_logs o
      where o.team_id = b.team_id and o.event_type = 'submit_order'
        and o.created_at > b.created_at and o.created_at < b.created_at + interval '60 seconds'
      order by o.created_at limit 1
    ) o on true
    where b.event_type = 'broadcast_seen'
    group by b.team_id
  ),
  merged as (
    select t.id as team_id,
           coalesce(tu.traded_amount, 0)::numeric / nullif(ae.avg_eq, 0) as turnover_rate,
           coalesce(pt.mdd, 0) as mdd,
           coalesce(c.hhi, 0) as hhi,
           f.reaction_ms as fomo_reaction_ms
    from teams t
    left join turnover tu on tu.team_id = t.id
    left join avg_equity ae on ae.team_id = t.id
    left join peak_trough pt on pt.team_id = t.id
    left join concentration c on c.team_id = t.id
    left join fomo f on f.team_id = t.id
  ),
  ranked as (
    -- 회전율 상위 10%('빛보다 빠른 손') 판정용. 팀 수가 적으면 상위 10%가 극단적으로 좁아질
    -- 수 있다 — 데이터 특성상 어쩔 수 없는 부분.
    select team_id, percent_rank() over (order by coalesce(turnover_rate, 0) desc) as turnover_pct_rank
    from merged
  ),
  zero_trade_rounds as (
    -- 1..current_round 중 그 팀이 한 건도 체결하지 않은 라운드 수('존버의 달인' 판정용).
    select tm.id as team_id, count(*) as zero_rounds
    from teams tm
    cross join generate_series(1, greatest((select current_round from game_state where id = 1), 0)) as r(round)
    left join trades tr on tr.team_id = tm.id and tr.round = r.round
    where tr.id is null
    group by tm.id
  ),
  hedge_flag as (
    select team_id from game_trade_logs where event_type = 'hedge_executed' group by team_id
  )
  insert into game_team_analytics (team_id, turnover_rate, hhi, mdd, fomo_reaction_ms, archetype, badges, computed_at)
  select
    m.team_id, m.turnover_rate, m.hhi, m.mdd, m.fomo_reaction_ms,
    -- HHI 극단(몰빵/분산)이 회전율보다 우선하는 4분류 — 위 [확정됨] 참고.
    case
      when m.hhi > 4000 then '몰빵형'
      when m.hhi < 2000 then '분산투자형'
      when coalesce(m.turnover_rate, 0) > 1.0 then '단타형'
      else '가치투자형'
    end as archetype,
    array_remove(array[
      case when coalesce(z.zero_rounds, 0) >= 3 then '존버의 달인' end,
      case when r.turnover_pct_rank <= 0.1 then '빛보다 빠른 손' end,
      case when h.team_id is not null then '철벽 방어' end
    ], null) as badges,
    now()
  from merged m
  left join ranked r on r.team_id = m.team_id
  left join zero_trade_rounds z on z.team_id = m.team_id
  left join hedge_flag h on h.team_id = m.team_id
  on conflict (team_id) do update set
    turnover_rate = excluded.turnover_rate, hhi = excluded.hhi, mdd = excluded.mdd,
    fomo_reaction_ms = excluded.fomo_reaction_ms, archetype = excluded.archetype,
    badges = excluded.badges, computed_at = excluded.computed_at;

  get diagnostics v_computed = row_count;
  return jsonb_build_object('ok', true, 'computed', v_computed);
end;
$$;

grant execute on function admin_compute_team_analytics(text) to anon, authenticated;

-- reset_game — 최신 정의(0032)에 game_trade_logs·game_team_analytics 삭제 두 줄만 추가.
-- (0032 기준: order_sheets delete 없음, private.config의 game_pin 삭제 포함 — 그대로 유지)
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

  delete from round_snapshots where true;
  delete from trades where true;
  delete from positions where true;
  delete from hint_grants where true;
  delete from broadcasts where true;
  delete from game_trade_logs where true;
  delete from game_team_analytics where true;
  update teams set cash = seed where true;

  delete from private.config where key = 'game_pin';

  update game_state
    set current_round = 0, is_locked = false, is_ended = false, round_ends_at = null
  where id = 1;

  perform emit_signal('game_reset', '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function reset_game(text) to anon, authenticated;
