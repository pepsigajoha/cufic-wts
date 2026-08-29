-- 가격 경로 생성 = 입력 방식에 따라 2트랙.
--
--  트랙 1 (엑셀 업로드 · AdminStocks 수동 편집 등 stocks.prices 직접 쓰기)
--     → 트리거가 자동으로 "브라운 브리지"로 연도 사이 252스텝 경로를 보간해 저장.
--       양 끝(직전 연말가 → 입력한 연말가)은 정확히 고정 → 재무·시황·힌트 시나리오 100% 보존.
--
--  트랙 2 (주가 생성기: simulateNextRound / generatePriceSeries)
--     → 7팩터·GARCH·점프확산 엔진의 raw 252스텝 경로를 그대로 저장(끝점 핀·선형보정 없음).
--       각 경로의 마지막 값을 stocks.prices에 연말 확정가로 dual-write.
--
-- 구분 신호: admin_apply_simulated_prices가 set_config('app.skip_bridge','1')로 트리거를 잠재우고
--            stock_price_paths.source='engine'으로 표시한다. 트리거는 source='engine' 행을
--            (그 연도 값이 실제로 안 바뀌었으면) 건드리지 않는다.

-- ─────────────────────────────────────────────
-- 1. 경로 출처 표시
-- ─────────────────────────────────────────────
alter table stock_price_paths
  add column if not exists source text not null default 'bridge'
  check (source in ('bridge', 'engine'));

-- ─────────────────────────────────────────────
-- 2. 결정론적 기하 브라운 브리지 — from → to 를 잇는 252스텝. 첫·끝 점은 정확히 고정.
--    시드는 private.tick_hash_seed(종목:연도) → 새로고침·다른 학생 화면에서 동일.
--    난수는 이미 검증된 private.tick_mulberry32_seq(재사용) + Box–Muller.
-- ─────────────────────────────────────────────
create or replace function private.bridge_path(
  p_seed_key text,
  p_from numeric,
  p_to numeric,
  p_sigma double precision default 0.0045
)
returns numeric[]
language plpgsql
immutable
as $$
declare
  n constant int := 252;
  f double precision := greatest(coalesce(p_from, 0), 1);
  tgt double precision := greatest(coalesce(p_to, 0), 1);
  u double precision[];              -- 2n개의 균등난수
  w double precision[];              -- 누적 가우시안
  g double precision;
  wend double precision;
  l0 double precision := ln(f);
  lt double precision := ln(tgt);
  res numeric[] := '{}';
  t double precision;
  br double precision;
begin
  u := private.tick_mulberry32_seq(private.tick_hash_seed(0, p_seed_key), 2 * n);
  w := array_fill(0.0::double precision, array[n]);
  for i in 2 .. n loop
    -- Box–Muller: u[2i-3], u[2i-2] (1-인덱스). ln(0) 방지로 하한 클램프.
    g := sqrt(-2.0 * ln(greatest(u[2 * i - 3], 1e-12))) * cos(2.0 * pi() * u[2 * i - 2]);
    w[i] := w[i - 1] + g;
  end loop;
  wend := w[n];

  for i in 1 .. n loop
    t := (i - 1)::double precision / (n - 1);
    br := w[i] - t * wend;                                  -- B(t) - t·B(1)  (양 끝 0)
    res := res || round(greatest(1.0, exp(l0 + (lt - l0) * t + p_sigma * br)))::numeric;
  end loop;
  res[1] := round(greatest(1.0, coalesce(p_from, 1)))::numeric;
  res[n] := round(greatest(1.0, coalesce(p_to, 1)))::numeric;
  return res;
end;
$$;

-- ─────────────────────────────────────────────
-- 3. 한 종목의 브리지 경로를 (재)생성. p_force=false면 source='engine'·값 미변경 연도는 건너뛴다.
--    from = stocks.prices에서 직전(가장 큰 더 작은) 연도 값, 없으면 to*0.9.
-- ─────────────────────────────────────────────
create or replace function private.regen_bridge_for_stock(p_stock_id text, p_force boolean default false)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prices jsonb;
  v_years int[];
  v_from numeric;
  v_to numeric;
  v_src text;
  v_n int := 0;
begin
  select prices into v_prices from stocks where id = p_stock_id;
  if v_prices is null then return 0; end if;

  select array_agg(k::int order by k::int) into v_years
  from jsonb_object_keys(v_prices) k
  where k ~ '^\d+$' and (v_prices ->> k) ~ '^-?[0-9.]+$';
  if v_years is null then return 0; end if;

  for i in 1 .. array_length(v_years, 1) loop
    v_to := (v_prices ->> v_years[i]::text)::numeric;
    if v_to is null or v_to <= 0 then continue; end if;   -- 거래정지/상장예정 연도 제외

    v_from := case when i > 1 then (v_prices ->> v_years[i - 1]::text)::numeric else null end;
    if v_from is null or v_from <= 0 then v_from := v_to * 0.9; end if;

    if not p_force then
      select source into v_src from stock_price_paths
      where stock_id = p_stock_id and year = v_years[i];
      if v_src = 'engine' then continue; end if;          -- 엔진 경로는 강제 아니면 보존
    end if;

    insert into stock_price_paths (stock_id, year, prices, source, updated_at)
    values (p_stock_id, v_years[i],
            private.bridge_path(p_stock_id || ':' || v_years[i]::text, v_from, v_to),
            'bridge', now())
    on conflict (stock_id, year)
      do update set prices = excluded.prices, source = 'bridge', updated_at = now();
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- 전체 종목 일괄(초기화·전면 재보간용). p_force=true면 엔진 경로까지 전부 브리지로 덮는다.
create or replace function private.regen_all_bridge_paths(p_force boolean default false)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_total int := 0; r record;
begin
  for r in select id from stocks loop
    v_total := v_total + private.regen_bridge_for_stock(r.id, p_force);
  end loop;
  return v_total;
end;
$$;

-- ─────────────────────────────────────────────
-- 4. 트리거 — stocks.prices가 (엑셀/수동으로) 바뀌면 그 연도(+다음 연도)의 브리지를 다시 만든다.
--    app.skip_bridge='1'이면(=주가 생성기 경로) 건너뛴다.
--    재생성 조건: 그 연도 값이 바뀜 OR 직전 연도 값이 바뀜(시작점 이동) OR 경로 행이 아직 없음.
--    → 손 안 댄 engine/bridge 연도는 그대로 둔다.
-- ─────────────────────────────────────────────
create or replace function private.stocks_bridge_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_years int[];
  v_to numeric;
  v_from numeric;
  self_changed boolean;
  prev_changed boolean;
  has_row boolean;
begin
  if coalesce(current_setting('app.skip_bridge', true), '') = '1' then
    return null;
  end if;

  select array_agg(k::int order by k::int) into v_years
  from jsonb_object_keys(NEW.prices) k
  where k ~ '^\d+$' and (NEW.prices ->> k) ~ '^-?[0-9.]+$';
  if v_years is null then return null; end if;

  for i in 1 .. array_length(v_years, 1) loop
    v_to := (NEW.prices ->> v_years[i]::text)::numeric;
    if v_to is null or v_to <= 0 then continue; end if;

    self_changed := (coalesce(OLD.prices, '{}'::jsonb) ->> v_years[i]::text)
                    is distinct from (NEW.prices ->> v_years[i]::text);
    prev_changed := i > 1 and
      ((coalesce(OLD.prices, '{}'::jsonb) ->> v_years[i - 1]::text)
       is distinct from (NEW.prices ->> v_years[i - 1]::text));
    select exists(select 1 from stock_price_paths where stock_id = NEW.id and year = v_years[i])
      into has_row;

    if not (self_changed or prev_changed or not has_row) then
      continue;
    end if;

    v_from := case when i > 1 then (NEW.prices ->> v_years[i - 1]::text)::numeric else null end;
    if v_from is null or v_from <= 0 then v_from := v_to * 0.9; end if;

    insert into stock_price_paths (stock_id, year, prices, source, updated_at)
    values (NEW.id, v_years[i],
            private.bridge_path(NEW.id || ':' || v_years[i]::text, v_from, v_to),
            'bridge', now())
    on conflict (stock_id, year)
      do update set prices = excluded.prices, source = 'bridge', updated_at = now();
  end loop;

  return null; -- AFTER 트리거
end;
$$;

drop trigger if exists stocks_bridge_paths on stocks;
create trigger stocks_bridge_paths
  after insert or update of prices on stocks
  for each row execute function private.stocks_bridge_trg();

-- ─────────────────────────────────────────────
-- 5. admin_apply_simulated_prices v3 — 엔진 트랙.
--    · 시작에 app.skip_bridge='1' → stocks.prices dual-write가 트리거를 안 깨움
--    · 경로는 source='engine'으로 저장(트리거가 함부로 안 덮음)
--    · p_paths 형태 2가지 지원:
--        { [sid]: number[252] }            + p_year   → 단일 연도
--        { [sid]: { [year]: number[252] } } (p_year=null) → 다연도 배치
-- ─────────────────────────────────────────────
create or replace function admin_apply_simulated_prices(
  p_admin_secret text,
  p_prices jsonb default null,
  p_paths jsonb default null,
  p_year int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scalar_applied int := 0;
  v_path_applied int := 0;
  v_sid text;
  v_val jsonb;
  v_yr text;
  v_yarr jsonb;
  v_nums numeric[];
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  perform set_config('app.skip_bridge', '1', true); -- 이 트랜잭션 동안 브리지 트리거 정지

  -- (A) 스칼라 — 기존 방식(엑셀 아님, 생성기 미리보기 확정 등)
  if p_prices is not null and jsonb_typeof(p_prices) = 'object' and p_prices <> '{}'::jsonb then
    update stocks s set prices = p_prices -> s.id
    where s.id in (select jsonb_object_keys(p_prices));
    get diagnostics v_scalar_applied = row_count;
  end if;

  -- (B) 엔진 경로
  if p_paths is not null and jsonb_typeof(p_paths) = 'object' and p_paths <> '{}'::jsonb then
    for v_sid, v_val in select * from jsonb_each(p_paths) loop
      if not exists (select 1 from stocks where id = v_sid) then continue; end if;

      if jsonb_typeof(v_val) = 'array' then
        -- 단일 연도 형태 — p_year 필수
        if p_year is null or jsonb_array_length(v_val) <> 252 then continue; end if;
        select array_agg((e)::numeric order by ord) into v_nums
        from jsonb_array_elements_text(v_val) with ordinality as t(e, ord);

        insert into stock_price_paths (stock_id, year, prices, source, updated_at)
        values (v_sid, p_year, v_nums, 'engine', now())
        on conflict (stock_id, year)
          do update set prices = excluded.prices, source = 'engine', updated_at = now();
        update stocks
          set prices = coalesce(prices, '{}'::jsonb) || jsonb_build_object(p_year::text, round(v_nums[252]))
        where id = v_sid;
        v_path_applied := v_path_applied + 1;

      elsif jsonb_typeof(v_val) = 'object' then
        -- 다연도 형태 { [year]: [252] }
        for v_yr, v_yarr in select * from jsonb_each(v_val) loop
          if v_yr !~ '^\d+$' or jsonb_typeof(v_yarr) <> 'array' or jsonb_array_length(v_yarr) <> 252 then
            continue;
          end if;
          select array_agg((e)::numeric order by ord) into v_nums
          from jsonb_array_elements_text(v_yarr) with ordinality as t(e, ord);

          insert into stock_price_paths (stock_id, year, prices, source, updated_at)
          values (v_sid, v_yr::int, v_nums, 'engine', now())
          on conflict (stock_id, year)
            do update set prices = excluded.prices, source = 'engine', updated_at = now();
          update stocks
            set prices = coalesce(prices, '{}'::jsonb) || jsonb_build_object(v_yr, round(v_nums[252]))
          where id = v_sid;
          v_path_applied := v_path_applied + 1;
        end loop;
      end if;
    end loop;
  end if;

  perform emit_signal('stocks_changed',
    jsonb_build_object('source', 'simulator', 'scalar', v_scalar_applied, 'paths', v_path_applied));
  return jsonb_build_object('ok', true, 'scalar_applied', v_scalar_applied, 'paths_applied', v_path_applied);
end;
$$;

grant execute on function admin_apply_simulated_prices(text, jsonb, jsonb, int) to anon, authenticated;
