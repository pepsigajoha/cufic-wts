-- 실시간 체결가 함수 (1/2 — 함수 추가만, place_order 동작은 아직 안 바꾼다).
--
-- 배경: src/realtimeTick.js의 tickPrice()는 지금까지 "화면용 순수 시각 효과"였다(주석에
-- "실제 체결가·평가금액은 이 값을 전혀 참조하지 않는다"고 명시). 이제 그 흔들림 값 자체를
-- 실제 체결가로 쓰기로 했다 — 단, 클라이언트가 계산한 값을 place_order 파라미터로 받는 건
-- 절대 안 된다(학생이 콘솔에서 원하는 가격을 그대로 보낼 수 있는 가격 조작 취약점이 된다).
-- 그래서 같은 공식을 서버(plpgsql)에 그대로 이식해서, place_order가 "지금 이 순간"의 값을
-- 스스로 계산하게 만든다. src/realtimeTick.js의 mulberry32/하모닉 합성 공식과 한 글자도
-- 다르지 않게 옮기는 게 목표다 — 여기 있는 매직넘버(0x6d2b79f5=1831565813, 31, 15, 7, 61, 14,
-- CYCLE_MS=10000)는 전부 그 파일에서 그대로 가져온 것이다. 저 파일을 고치면 여기도 같이
-- 고쳐야 한다.
--
-- private 스키마에 둔다 — PostgREST가 private을 노출하지 않으므로(admin_secret과 동일 원리)
-- anon 롤에 grant를 하나도 안 줘도 된다. place_order(security definer)가 내부에서만 부른다.
--
-- [주의] JS의 비트 연산(^ >>> | Math.imul)은 내부적으로 항상 피연산자를 32비트로 자른 뒤
-- 계산한다 — 그래서 모든 중간값을 "0 이상 2^32 미만의 uint32 대표값"으로만 다루면, 그 값이
-- JS에서 부호 있는 int32로 해석되는지 여부와 무관하게 결과가 정확히 일치한다(두 표현은
-- 2^32를 법으로 합동이고 곱셈·XOR·시프트는 그 합동 관계를 보존하므로). tick_imul_u32는
-- 32비트×32비트가 bigint 범위(2^63-1)를 넘을 수 있어(최대 약 1.8×10^19) numeric으로 계산한다.

create or replace function private.tick_imul_u32(a bigint, b bigint)
returns bigint
language sql
immutable
as $$
  select (((a % 4294967296)::numeric * (b % 4294967296)::numeric) % 4294967296::numeric)::bigint;
$$;

-- hashSeed(seed, stockId) 이식. ascii()는 UTF8 DB에서 유니코드 코드포인트를 돌려주므로
-- (BMP 범위 안이면) JS charCodeAt과 동일한 값을 낸다 — 종목코드가 짧은 영숫자 코드라는
-- 전제(이 게임의 실제 종목코드 규칙)에서만 정확하다.
create or replace function private.tick_hash_seed(p_seed bigint, p_stock_id text)
returns bigint
language plpgsql
immutable
as $$
declare
  h bigint;
  i int;
  c int;
begin
  h := p_seed % 4294967296;
  if h < 0 then h := h + 4294967296; end if;

  for i in 1..length(p_stock_id) loop
    c := ascii(substr(p_stock_id, i, 1));
    h := (private.tick_imul_u32(h, 31) + c) % 4294967296;
  end loop;

  return h;
end;
$$;

-- mulberry32(seed)를 n번 호출한 시퀀스. realtimeTick.js의 harmonics()가 rand()를 n번
-- 연쇄 호출하는 것과 동일 순서로 결과를 낸다(1-indexed 배열이라 out[1]이 첫 호출값).
create or replace function private.tick_mulberry32_seq(p_seed bigint, p_count int)
returns double precision[]
language plpgsql
immutable
as $$
declare
  a bigint;
  t bigint;
  out_vals double precision[] := '{}';
  i int;
begin
  a := p_seed % 4294967296;
  if a < 0 then a := a + 4294967296; end if;

  for i in 1..p_count loop
    a := (a + 1831565813) % 4294967296; -- 0x6d2b79f5
    t := private.tick_imul_u32((a # (a >> 15)), (1 | a));
    t := ((t + private.tick_imul_u32((t # (t >> 7)), (61 | t))) % 4294967296) # t;
    out_vals := array_append(out_vals, ((t # (t >> 14)))::double precision / 4294967296.0);
  end loop;

  return out_vals;
end;
$$;

-- harmonics(seed, stockId, 5) + noiseAt(harmonics, phaseFrac) 통합.
-- freq=i, amp=1/i (i=1..5)는 랜덤이 아니라 realtimeTick.js와 동일한 고정 공식이고,
-- phase만 시드에서 뽑는다.
create or replace function private.tick_noise(p_seed bigint, p_stock_id text, p_phase_frac double precision, p_n int default 5)
returns double precision
language plpgsql
immutable
as $$
declare
  rand_vals double precision[] := private.tick_mulberry32_seq(private.tick_hash_seed(p_seed, p_stock_id), p_n);
  freq int;
  amp double precision;
  phase double precision;
  sum_val double precision := 0;
  norm double precision := 0;
  i int;
begin
  for i in 1..p_n loop
    freq := i;
    amp := 1.0 / i;
    phase := rand_vals[i] * 2 * pi();
    sum_val := sum_val + amp * sin(2 * pi() * freq * p_phase_frac + phase);
    norm := norm + amp;
  end loop;

  if norm > 0 then
    return sum_val / norm;
  else
    return 0;
  end if;
end;
$$;

-- tickPrice({officialPrice, seed, stockId, now, remainingMs, taperMs, sigma}) 이식.
-- p_at은 호출부(place_order)가 now()를 넘긴다 — 이 함수 자체는 순수 함수로 유지한다
-- (내부에서 now()를 직접 읽지 않는다. 같은 인자 → 항상 같은 결과).
create or replace function private.tick_price(
  p_official_price bigint,
  p_seed bigint,
  p_stock_id text,
  p_at timestamptz,
  p_remaining_ms double precision,
  p_taper_ms double precision default 15000,
  p_sigma double precision default 0.03
)
returns bigint
language plpgsql
immutable
as $$
declare
  remain double precision;
  envelope double precision;
  cycle_ms constant double precision := 10000;
  t_ms double precision;
  phase_frac double precision;
  z double precision;
  wiggle double precision;
begin
  if p_official_price is null or p_official_price <= 0 then
    return greatest(1, round(coalesce(p_official_price, 0)::numeric)::bigint);
  end if;

  remain := greatest(0, coalesce(p_remaining_ms, 0));
  envelope := case
    when p_taper_ms > 0 then least(1, remain / p_taper_ms)
    when remain > 0 then 1
    else 0
  end;

  if envelope <= 0 then
    return greatest(1, round(p_official_price::numeric)::bigint);
  end if;

  t_ms := extract(epoch from p_at) * 1000;
  phase_frac := (t_ms - floor(t_ms / cycle_ms) * cycle_ms) / cycle_ms;

  z := private.tick_noise(p_seed, p_stock_id, phase_frac);
  wiggle := p_official_price * p_sigma * envelope * z;

  return greatest(1, round((p_official_price + wiggle)::numeric)::bigint);
end;
$$;

comment on function private.tick_price(bigint, bigint, text, timestamptz, double precision, double precision, double precision) is
  'src/realtimeTick.js의 tickPrice()를 그대로 이식한 서버측 실시간 체결가 계산. 순수 함수(부작용 없음).
   place_order가 공식가(current_price) 대신 이 값으로 체결한다(20260826000037). 저 JS 파일을
   고치면 이 함수도 같이 고쳐야 한다 — scripts/verify-tick-price-parity.mjs로 두 구현의 수치 일치를 확인한다.';

-- 이 마이그레이션은 place_order를 아직 건드리지 않는다 — 여기까지는 순수 함수 추가일
-- 뿐이라 push해도 기존 게임 동작(라운드 고정가 체결)이 전혀 바뀌지 않는다.
