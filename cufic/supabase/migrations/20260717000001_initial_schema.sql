-- CUFIC WTS 초기 스키마
--
-- 원칙:
--   * 금액은 bigint(원 단위 정수). 부동소수점 금지. 평균단가만 numeric.
--   * impact는 'up'|'down'|'flat' — 프론트와 용어 통일 (neutral 쓰지 않음)
--   * 쓰기는 RPC로만. 클라이언트가 teams.cash를 직접 update할 수 없어야 한다.

-- ─────────────────────────────────────────────
-- 게임(대회) 설정: 단일 행
-- ─────────────────────────────────────────────
create table game_state (
  id int primary key default 1 check (id = 1),
  current_round int not null default 0,        -- 0 = 시작 전
  total_rounds int not null,
  round_year_map jsonb not null,               -- {"1": 2022, "2": 2023, ...}
  default_seed bigint not null default 100000000,
  is_locked boolean not null default false     -- 라운드 정산 중 주문 잠금
);

comment on column game_state.current_round is '0이면 시작 전. advance_round()로 증가';
comment on column game_state.is_locked is 'true면 place_order가 round_locked로 거부';

-- ─────────────────────────────────────────────
-- 종목 (관리자가 이름·가격 편집 가능)
-- ─────────────────────────────────────────────
create table stocks (
  id text primary key,                          -- 종목코드 (예: '005930')
  name text not null,
  description text default '',                  -- 한 줄 소개
  sector text default '',
  listed_from_round int not null default 1,     -- 신규상장: 이 라운드부터 노출
  prices jsonb not null,                        -- {"2021": 78300, "2022": 55300, ...}
  display_order int not null default 0
);

comment on column stocks.prices is
  '연도 → 가격. 값이 없거나 0이면 거래정지(매수·매도 차단, 평가액 0)';

-- 뉴스의 related_stock_ids가 이름이 아닌 id를 참조하므로 이름 중복은 허용된다.
-- 다만 화면에서 헷갈리므로 유니크로 막는다.
create unique index stocks_name_key on stocks (name);

-- ─────────────────────────────────────────────
-- 조(팀)
-- ─────────────────────────────────────────────
create table teams (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,                    -- 참가 코드 (TIGER-03)
  name text not null,
  seed bigint not null,                         -- 초기 자본 (조별 개별 설정 가능)
  cash bigint not null,                         -- 현재 예수금
  created_at timestamptz default now(),
  constraint teams_seed_positive check (seed > 0),
  constraint teams_cash_not_negative check (cash >= 0)
);

-- ─────────────────────────────────────────────
-- 보유 종목 (전량 매도 시 행 삭제)
-- ─────────────────────────────────────────────
create table positions (
  team_id uuid references teams(id) on delete cascade,
  stock_id text references stocks(id) on delete cascade,
  quantity int not null check (quantity >= 0),
  avg_price numeric not null default 0,
  primary key (team_id, stock_id)
);

-- ─────────────────────────────────────────────
-- 체결 내역
-- ─────────────────────────────────────────────
create table trades (
  id bigint generated always as identity primary key,
  team_id uuid references teams(id) on delete cascade,
  stock_id text references stocks(id) on delete cascade,
  side text not null check (side in ('buy','sell')),
  price bigint not null check (price > 0),
  quantity int not null check (quantity > 0),
  round int not null,
  realized_pnl bigint,                          -- 매도 시에만. 매수는 null
  created_at timestamptz default now()
);

create index trades_team_idx on trades (team_id, created_at desc);

comment on column trades.realized_pnl is
  '매도 시점 (체결가 - 평균단가) * 수량. 매수는 null (아직 확정되지 않음)';

-- ─────────────────────────────────────────────
-- 라운드별 자산 스냅샷 (수익률 차트·리더보드 기록용)
-- ─────────────────────────────────────────────
create table round_snapshots (
  team_id uuid references teams(id) on delete cascade,
  round int not null,
  equity bigint not null,                       -- 그 라운드를 떠날 때의 평가금액
  primary key (team_id, round)
);

-- ─────────────────────────────────────────────
-- 시황 뉴스 (관리자 발동)
-- ─────────────────────────────────────────────
create table news (
  id bigint generated always as identity primary key,
  round int not null,
  headline text not null,
  impact text not null check (impact in ('up','down','flat')),
  related_stock_ids text[] not null default '{}',
  published_at timestamptz default now(),
  is_published boolean not null default false   -- 미리 써두고 발동 시 true
);

create index news_published_idx on news (is_published, round);

comment on column news.impact is
  'up=호재(빨강) / down=악재(파랑) / flat=중립(회색). 프론트와 동일 용어';
comment on column news.related_stock_ids is
  'stocks.id 배열. 실존하지 않는 id가 들어가지 않도록 관리자 UI가 stocks에서 고르게 한다';

-- ─────────────────────────────────────────────
-- RLS — 읽기는 모두 허용, 쓰기는 RPC로만
-- ─────────────────────────────────────────────
-- 교육용 수준: anon key로 접속하되 클라이언트가 직접 cash를 조작할 수 없어야 한다.
-- 정책을 만들지 않으면 RLS 활성 테이블은 기본 거부이므로, select 정책만 연다.
-- 쓰기 경로는 security definer 함수(RPC)뿐이다.
alter table game_state enable row level security;
alter table stocks enable row level security;
alter table teams enable row level security;
alter table positions enable row level security;
alter table trades enable row level security;
alter table round_snapshots enable row level security;
alter table news enable row level security;

create policy "read game_state" on game_state for select using (true);
create policy "read stocks" on stocks for select using (true);
create policy "read teams" on teams for select using (true);
create policy "read positions" on positions for select using (true);
create policy "read trades" on trades for select using (true);
create policy "read round_snapshots" on round_snapshots for select using (true);
-- 발동되지 않은 뉴스는 스포일러다 — 읽기 자체를 막는다
create policy "read published news" on news for select using (is_published = true);

-- insert/update/delete 정책 없음 = 클라이언트 직접 쓰기 전면 차단.
-- 모든 변경은 RPC(security definer)를 통한다.
