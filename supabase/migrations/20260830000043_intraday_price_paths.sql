-- 장중(인트라데이) 가격 경로 — 라운드 = 1년 = priceSim.js의 252 스텝 전체를 저장한다.
--
-- [설계: current_price는 손대지 않는다]
-- current_price(종목)는 team_equity·round_snapshots·settle_options_round·과거 라운드 차트가
-- 전부 쓰는 "연말 확정가(스칼라)"다. 여기에 장중 변동을 넣으면 라운드 중 리더보드가
-- 매초 흔들리고(CLAUDE.md 규칙 위반) advance_round 스냅샷이 경로 중간값을 찍는다.
-- 그래서 current_price는 그대로 두고, "체결 시점 가격"만 새 함수 private.exec_price로 뽑는다.
--   - 평가/정산/과거차트  → current_price (연말 스칼라, 변경 없음)
--   - 체결(place_order)·옵션 스팟 → exec_price (경로의 지금 스텝 값, 없으면 current_price로 폴백)
--
-- [스텝 인덱스] round_start_at ~ round_ends_at 사이 진행률 × 252 (0..251로 클램프).
-- round_start_at이 없으면(옛 데이터·타이머 미시작) 251로 봐서 exec_price == current_price.
-- adjust_round_timer로 round_ends_at만 늘/줄면 남은 구간에서 스텝 진행 속도가 바뀐다(허용).

-- ─────────────────────────────────────────────
-- 1. 라운드 시작 시각 — 진행률 계산의 기준점
-- ─────────────────────────────────────────────
alter table game_state add column if not exists round_start_at timestamptz;
comment on column game_state.round_start_at is
  '현재 라운드 거래 타이머를 연 시각. private.round_step_idx()가 (now-start)/(end-start) 진행률을 낸다. null이면 스텝=251(연말가).';

-- ─────────────────────────────────────────────
-- 2. 일별 가격 경로 테이블 (종목 × 연도 → 252개 가격)
-- ─────────────────────────────────────────────
create table if not exists stock_price_paths (
  stock_id text not null references stocks(id) on delete cascade,
  year int not null,
  prices numeric[] not null check (array_length(prices, 1) = 252),
  updated_at timestamptz not null default now(),
  primary key (stock_id, year)
);

comment on table stock_price_paths is
  '라운드(=연도) 하나의 장중 252일 가격 경로. priceSim.simulateNextRound({returnPath:true}) 산출물. 마지막 원소(prices[252])는 stocks.prices의 그 연도 값과 일치해야 한다(admin_apply_simulated_prices가 함께 기록).';

alter table stock_price_paths enable row level security;
create policy "read stock_price_paths" on stock_price_paths for select using (true); -- 학생이 차트를 그리려면 봐야 한다

-- ─────────────────────────────────────────────
-- 3. 스칼라 → 252 평탄 배열 (하위호환 헬퍼 + 백필)
-- ─────────────────────────────────────────────
create or replace function private.expand_scalar_to_path(p numeric)
returns numeric[]
language sql
immutable
as $$ select array_fill(coalesce(p, 0)::numeric, array[252]); $$;

-- 기존 stocks.prices의 모든 (종목, 연도) 스칼라를 평탄한 252 경로로 백필한다.
-- 장중 데이터가 없는 옛 데이터셋은 수평선으로 그려지고, exec_price는 항상 경로를 찾게 된다.
do $$
declare
  r record;
begin
  for r in
    select s.id as stock_id, (kv.key)::int as year, (kv.value)::numeric as price
    from stocks s, jsonb_each_text(coalesce(s.prices, '{}'::jsonb)) kv
    where kv.value ~ '^-?[0-9.]+$'
  loop
    insert into stock_price_paths (stock_id, year, prices)
    values (r.stock_id, r.year, private.expand_scalar_to_path(r.price))
    on conflict (stock_id, year) do nothing;
  end loop;
end $$;

-- ─────────────────────────────────────────────
-- 4. 스텝 인덱스 (0..251) — 진행률 × 252
-- ─────────────────────────────────────────────
create or replace function private.round_step_idx()
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_ends  timestamptz;
  v_locked boolean;
  v_span double precision;
  v_frac double precision;
begin
  select round_start_at, round_ends_at, is_locked
    into v_start, v_ends, v_locked
  from game_state where id = 1;

  -- 타이머 정보가 불완전하거나 잠겨 있으면 연말(마지막 스텝)로 본다 → exec_price == current_price
  if v_start is null or v_ends is null or v_locked then
    return 251;
  end if;

  v_span := extract(epoch from (v_ends - v_start));
  if v_span <= 0 then
    return 251;
  end if;

  v_frac := (extract(epoch from now()) - extract(epoch from v_start)) / v_span;
  return least(251, greatest(0, floor(v_frac * 252)::int));
end;
$$;

grant execute on function private.round_step_idx() to anon, authenticated;

-- ─────────────────────────────────────────────
-- 5. 체결가 — 경로의 지금 스텝 값. 경로가 없으면 current_price(연말 스칼라)로 폴백.
-- ─────────────────────────────────────────────
create or replace function private.exec_price(p_stock_id text)
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_year int;
  v_path numeric[];
  v_idx int;
begin
  select coalesce(
           (g.round_year_map ->> g.current_round::text)::int,
           g.final_year
         )
    into v_year
  from game_state g where g.id = 1;

  select prices into v_path
  from stock_price_paths
  where stock_id = p_stock_id and year = v_year;

  if v_path is null then
    return current_price(p_stock_id); -- 하위호환: 경로 없는 종목/연도
  end if;

  v_idx := private.round_step_idx();           -- 0..251
  return greatest(0, round(v_path[v_idx + 1])::bigint); -- PG 배열은 1-인덱스
end;
$$;

comment on function private.exec_price(text) is
  '체결·옵션 스팟 전용. current_price(연말 스칼라)와 달리 라운드 진행률에 해당하는 장중 스텝 가격을 낸다.
   src/gameData.js의 roundStepIndex()와 인덱스 공식이 일치해야 한다 — scripts/verify-intraday-step-parity.mjs.';

grant execute on function private.exec_price(text) to anon, authenticated;
