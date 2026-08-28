-- Phase 1 / Feature 1 — 라운드별 거시 시뮬레이션 파라미터 서버 저장(draft, dev DB 전용 적용 예정).
--
-- 배경: 지금은 AdminSimulator.jsx가 매크로 슬라이더 값을 sessionStorage에만 저장한다
-- (loadPersisted/savePersisted) — 브라우저를 새로고침하거나 다른 기기에서 관리자 화면을 열면
-- "이번 라운드에 실제로 어떤 값으로 시뮬레이션을 돌렸는지" 이력이 사라진다. round_configs는
-- 그 값을 라운드별로 서버에 남겨서, 감사(왜 이 라운드에 이 가격이 나왔는지)와 재현이
-- 가능하게 한다.
--
-- [스포일러 주의 — macro 테이블과 다른 점] macro 테이블(0020)은 공개 콘텐츠(학생이 읽는
-- 시황 요약)라 select using(true)로 열려 있다. round_configs는 그 반대다 — "미래 라운드
-- 가격을 생성하는 데 실제로 쓴 시뮬레이션 입력값"이라 학생이 보면 다음 라운드 등락 방향을
-- 정확히 계산해낼 수 있는 진짜 스포일러다. 그래서 RLS를 켜되 select 정책을 아예 안 만든다
-- (익명 select 전면 차단) — admin_* RPC로만 읽고 쓴다.

create table round_configs (
  round int primary key,
  macro jsonb not null,        -- {unemp,gdp,int_r,inf,sent,fx,oil,market_multiplier,...} — priceSim.js macroByYear[year]와 동일 shape + market_multiplier
  seed bigint,                 -- 그 라운드 생성에 쓴 시드(재현용, null이면 기본 시드 사용)
  note text default '',        -- 관리자 메모 ("금리 인상 시나리오" 등)
  updated_at timestamptz not null default now()
);

comment on column round_configs.macro is
  'admin/priceSim.js의 generatePriceSeries(macroByYear[year])에 그대로 넘기는 입력. market_multiplier는
   그 값과 별개로 최종 가격에 곱해지는 추가 스칼라(선택, 기본 1.0) — 프론트 적용 지점은 AdminSimulator.jsx.';

alter table round_configs enable row level security;
-- select 정책 없음 = anon 전면 차단(의도적 — 위 주석 참고). admin_* RPC로만 접근.

-- ─────────────────────────────────────────────
-- 저장/수정 (관리자)
-- ─────────────────────────────────────────────
create or replace function admin_upsert_round_config(
  p_admin_secret text,
  p_round int,
  p_macro jsonb,
  p_seed bigint default null,
  p_note text default ''
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
  if p_round is null or p_round < 1 then
    return jsonb_build_object('ok', false, 'error', 'invalid_round');
  end if;
  if p_macro is null or jsonb_typeof(p_macro) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'invalid_macro');
  end if;

  insert into round_configs (round, macro, seed, note, updated_at)
  values (p_round, p_macro, p_seed, coalesce(p_note, ''), now())
  on conflict (round) do update
    set macro = excluded.macro, seed = excluded.seed, note = excluded.note, updated_at = now();

  return jsonb_build_object('ok', true, 'round', p_round);
end;
$$;

-- ─────────────────────────────────────────────
-- 전체 조회 (관리자) — admin_list_financials/admin_list_macro와 동일 패턴(미래 라운드 포함이라 admin 전용)
-- ─────────────────────────────────────────────
create or replace function admin_list_round_configs(p_admin_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'round', round, 'macro', macro, 'seed', seed, 'note', note, 'updated_at', updated_at
         ) order by round), '[]'::jsonb)
    into v_rows
  from round_configs;

  return jsonb_build_object('ok', true, 'configs', v_rows);
end;
$$;

create or replace function admin_delete_round_config(p_admin_secret text, p_round int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  delete from round_configs where round = p_round;
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function admin_upsert_round_config(text, int, jsonb, bigint, text) to anon, authenticated;
grant execute on function admin_list_round_configs(text) to anon, authenticated;
grant execute on function admin_delete_round_config(text, int) to anon, authenticated;

-- reset_game — round_configs는 "콘텐츠"(재사용 가능한 시나리오 설계)라 stocks.prices와 같은
-- 취급을 한다: reset_game이 지우지 않는다(재무제표·시황도 안 지운다는 기존 규칙과 동일 원칙).
