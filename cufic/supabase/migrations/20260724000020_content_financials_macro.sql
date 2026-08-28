-- 콘텐츠를 DB로 (B, Phase 1): 재무제표·시황을 코드(data.js 번들)에서 DB 테이블로 옮긴다.
--
-- 지금까지 재무제표(financials)와 시황(MACRO)은 프론트 번들에만 있어, 바꾸려면 재빌드·재배포가
-- 필요했다. DB 테이블로 옮기면 관리자 화면에서 편집할 수 있고, 향후 콘텐츠 팩 전환의 기반이 된다.
--   · 읽기: 공개(anon select). 참조 데이터라 조별 격리가 필요 없다.
--   · 쓰기: 정책 없음 → 관리자 RPC(security definer)로만 (Phase 1b에서 추가).
--   · 종목 PK·positions/trades는 건드리지 않는다(실서비스 안전).

-- ── 재무제표 (종목 × 연도, 5지표). 값이 없는 연도(미상장/폐지)는 행을 넣지 않는다.
create table if not exists financials (
  stock_id text not null references stocks(id) on delete cascade,
  year int not null,
  revenue bigint,      -- 매출액(억원)
  op_income bigint,    -- 영업이익(억원, 적자면 음수)
  net_income bigint,   -- 당기순이익(억원, 적자면 음수)
  debt_ratio numeric,  -- 부채비율(%)
  roe numeric,         -- ROE(%)
  primary key (stock_id, year)
);
alter table financials enable row level security;
create policy "read financials" on financials for select using (true);
grant select on financials to anon, authenticated;

-- ── 시황 (연도별 거시경제 지표 + 한 줄 요약).
create table if not exists macro (
  year int primary key,
  summary text not null default '',
  rate numeric,          -- 기준금리(%)
  gdp numeric,           -- GDP 성장률(%)
  unemployment numeric,  -- 실업률(%)
  fx int,                -- 환율(원/$)
  cpi numeric,           -- 물가상승률(%)
  oil int                -- 국제유가($)
);
alter table macro enable row level security;
create policy "read macro" on macro for select using (true);
grant select on macro to anon, authenticated;
