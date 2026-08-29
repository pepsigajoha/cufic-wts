```markdown
# CUFIC WTS

청소년 교육용 라운드제 모의투자 WTS(Web Trading System). 학생이 조를 이뤄 참가하고, 강사(관리자)가 라운드(= 1년)를 넘기면 주가가 바뀌며 손익이 난다. 재무제표·시황·힌트를 근거로 다음 해에 오를 종목을 고르는 법을 가르치는 게 목적이다.

![CUFIC WTS 실시간 장중 모의투자 화면](docs/images/wts-trading-preview.png)

- 즉시 체결 + 라운드 타이머: 매수·매도를 누르면 서버(`place_order`)가 그 자리에서 체결한다. 단 거래는 관리자가 [타이머 시작]으로 연 동안에만 가능하다(기본 10분, 서버가 마감을 강제).
- 장중(인트라데이) 시세: 한 라운드는 252 스텝(= 1년치 일별 경로)으로 저장된다. 타이머가 흐르는 동안 진행률에 해당하는 스텝 가격으로 체결되고, 차트도 그 경로를 하루씩 드러낸다. → [장중 가격 시스템](#장중-가격-시스템-2트랙)
- [다음 연도로 넘어가기]를 누르면 그 해 마지막 스텝(= 연말 확정가)으로 정산돼 순위가 바뀌고, R2부터 힌트가 순위대로 자동 배분된다.
- 학생 화면 `/`: 참가 코드 또는 닉네임+PIN(자율 입장)으로 입장, 즉시 매매(현물 + 옵션/헷지), 차트·재무제표·시황·힌트, 조별 순위.
- 관리자 화면 `/?admin=1`: 데이터셋 선택·라운드 진행·타이머·속보·힌트·조/종목 관리·주가 생성기·옵션 계약·행동 분석·리더보드(프로젝터)·결과 내보내기.

---

## 기술 스택

| 분류 | 기술 / 도구 | 적용 및 상세 용도 |
|---|---|---|
| Frontend | React 18, Vite 5, CSS3, Vitest | WTS 학생/관리자 웹 UI, 실시간 렌더링, 174개 단위 테스트 |
| Backend & DB | Supabase (PostgreSQL 15), Supabase Realtime | 사용자 인증, 게임 상태 단방향 실시간 동기화, RLS 정책 |
| Logic & Serverless | Supabase RPC (PL/pgSQL), Edge Functions (Deno) | 서버 즉시 체결(`place_order`), 브리지 자동 트리거, AI 속보 생성 |
| AI / LLM | Google Gemini API (`gemini-2.5-flash`) | 라운드별 시황 기반 실시간 속보 생성 Edge Function |
| Quant Engine | Python, JavaScript (ESM) | 7팩터 거시경제 모델, GARCH(1,1), 머튼 점프 확산, 브라운 브리지, 블랙-숄즈 옵션 |
| Infra & Deploy | Vercel, GitHub Actions | 프론트 정적 배포, DB 무중단 Keep-Alive 자동화 워크플로우 |

---

## 이 저장소에 대하여

`cufic-wts`(main) + `cufic-wts-live`(live_price 브랜치)를 병합한 뒤, 장중 거래(intraday) 시스템을 얹은 통합본이다. 병합으로 들어온 것:

- 파생상품 / 옵션 헷지 — 풋·콜 매수, Black-Scholes 프리미엄, PayoffDiagram, 변동성 스마일
- 행동 텔레메트리 / 투자성향·배지 — 회전율·HHI·MDD·FOMO 반응시간 집계
- 예금(고정금리 복리) + 최종 벤치마크 비교
- 주가 생성기 — 7팩터/GARCH/점프확산 확률과정 엔진 (`src/admin/priceSim.js`, `sim_sandbox`에서 이식)
- AI 속보 — Supabase Edge Function(`generate-breaking-news`, Gemini) + 규칙 기반 폴백

그 위에 새로 만든 것 (마이그레이션 `0043`~`0045`):

- `stock_price_paths` 테이블 — 종목 × 연도 → 252일 가격 경로
- `private.exec_price` / `private.round_step_idx` — 진행률 → 스텝 → 체결가
- 2트랙 가격 생성 — 엑셀/수동 입력은 브라운 브리지, 주가 생성기는 raw 엔진 경로
- 관리자 UI 개편 — 상단 고정 상태바(`AdminHeader`), [시스템] 탭(`AdminSystem`), 4-그룹 탭, 시세 출처 뱃지

---

## 문서 지도 — 누가 무엇을 읽나

| 역할 | 먼저 볼 문서 |
|---|---|
| 강사(운영) | [OPERATIONS](docs/OPERATIONS.md) 당일 순서 · [MANUAL_ADMIN](docs/MANUAL_ADMIN.md) 관리자 화면 조작 · [GAME_RULES](docs/GAME_RULES.md) 규칙 |
| 교보재팀(제작) | [MANUAL_CONTENT](docs/MANUAL_CONTENT.md) 엑셀/화면으로 데이터 만들기 · [DATA_GUIDE](docs/DATA_GUIDE.md) 형식·정합성 참조 |
| 개발자(유지보수) | [CLAUDE.md](CLAUDE.md) 아키텍처 규칙(필독) · [STATUS](docs/STATUS.md) 현황 · [DECISIONS](docs/DECISIONS.md) 왜 그렇게 했나 · [ROADMAP](docs/ROADMAP.md) 남은 일 |
| 모두(참조) | [SCREENS](docs/SCREENS.md) 전 화면·버튼 설명 |

> ⚠️ `docs/`는 아직 병합·장중 시스템 이전 기준으로 쓰여 있는 부분이 있다. 최신 동작은 이 README와 `supabase/migrations/`의 각 파일 헤더 주석이 기준이다.

---

## 로컬 실행

```bash
git clone <이 저장소>
cd merged
npm install
cp .env.example .env      # 값을 채운다 (아래)
npm run dev               # http://localhost:5173  (관리자 http://localhost:5173/?admin=1)
npm test                  # Vitest (현재 174 통과)
npm run build             # dist/

```

### .env

| 키 | 설명 | 비밀 | 배포에 필요 |
| --- | --- | --- | --- |
| `VITE_SUPABASE_URL` | Supabase Project URL | 아니오 | 예 |
| `VITE_SUPABASE_ANON_KEY` | anon public key — 브라우저 노출이 정상(RLS·RPC가 보호) | 아니오 | 예 |
| `VITE_ADMIN_PASSWORD` | 관리자 로그인 입력값. DB의 `admin_secret`과 같게. 번들엔 안 들어간다 | 예 | 아니오 |
| `VITE_GEMINI_API_KEY` | (선택) 미사용 — AI 속보 키는 Edge Function 서버 시크릿에만 둔다 | 예 | 아니오 |
| `SUPABASE_ACCESS_TOKEN` | CLI/Management API 전용 (마이그레이션 push, 스크립트) — 계정 스코프 PAT | 예 | 아니오 |
| `SUPABASE_DB_PASSWORD` | CLI 전용 | 예 | 아니오 |

`.env`는 커밋되지 않는다(`.gitignore`).

---

## 데이터베이스 (Supabase)

대시보드에서 스키마를 손으로 만들지 않는다 — `supabase/migrations/`가 유일한 원천이고 순서대로 적용된다 (현재 `0001` ~ `0045`).

### 마이그레이션 적용

```bash
# 방법 A — Supabase CLI (있으면)
npx supabase link --project-ref <ref>
npx supabase db push

# 방법 B — CLI 없이 Management API로 직접 (이 저장소 스크립트)
node scripts/apply-migrations.mjs --ref <ref> --token-env .env \
  supabase/migrations/2026XXXX_....sql  [다음 파일 ...]

```

### 두 프로젝트의 현재 상태

프로젝트는 한 계정(`pepsigajoha`) 아래 둘 있다.

| 프로젝트 | ref | 적용된 마이그레이션 | 용도 |
| --- | --- | --- | --- |
| dev | `dqvcagrbkvhnetqydgnk` | `0001` ~ `0045` (장중 시스템 포함) | 현재 개발·리허설 대상 |
| prod | `zhwidhvoxcoljffvqhol` | ~`0035`까지 (장중 시스템 미적용) | 과거 대회. 반영하려면 아래 순서로 |

> 장중 시스템을 쓰려면 `0036` ~ `0045`가 적용된 DB에 붙어야 한다. prod에 올리려면 백업 → `apply-migrations.mjs`로 `0036`~`0045` 순서 적용 → `node scripts/regen-bridge-paths.mjs` (아래). prod는 대회에 쓰이므로 CLAUDE.md의 "스키마 변경은 되돌릴 여유 없다" 경고를 따른다.

### 관리자 비밀번호

마이그레이션엔 없다(git에 남으면 안 되므로). SQL Editor에서 한 번 실행하고 `.env`의 `VITE_ADMIN_PASSWORD`와 맞춘다:

```sql
select private.set_admin_secret('원하는_비밀');

```

안 하면 관리자 기능이 전부 `unauthorized`로 잠긴 채 시작한다(의도된 fail-closed).

### 콘텐츠(데이터)

콘텐츠의 원천은 DB다. 관리자 [데이터셋] 탭에서 엑셀 양식으로 통째로 만들거나 각 탭에서 편집한다 → [MANUAL_CONTENT](https://www.google.com/search?q=docs/MANUAL_CONTENT.md). `src/data.js`(생성물)는 새 DB 초기 템플릿 + 테스트 원천용으로만 남아 있다.

```bash
node scripts/build-data.mjs   # JSON(주가·재무) + 소개·힌트 → src/data.js
node scripts/gen-seed.mjs     # src/data.js → supabase/seed.sql

```

---

## 장중 가격 시스템 (2트랙)

한 라운드(= 1년)는 252 스텝의 가격 경로로 저장된다(`stock_price_paths.prices numeric[252]`). 경로의 마지막 스텝(`prices[252]`) = 그 해 연말 확정가이며 `stocks.prices`의 그 연도 값과 항상 일치한다.

### 스텝 인덱스 = 진행률 × 252

```
step = LEAST(251, GREATEST(0, FLOOR((now - round_start_at) / (round_ends_at - round_start_at) * 252)))

```

* `private.round_step_idx()` (SQL) 와 `roundStepIndex()` (`src/chart.js`)가 같은 공식을 쓴다 — `node scripts/verify-intraday-step-parity.mjs`가 두 구현의 수치 일치를 검증한다.
* 타이머가 안 열렸거나(`round_ends_at is null`) 잠겨 있으면 step = 251(연말가)로 폴백.
* `start_round_timer`가 `round_start_at = now()`를 매번 새로 찍는다(타이머 재시작 시 스텝도 0부터).

### 체결가 / 평가가 분리

| 함수 | 값 | 쓰는 곳 |
| --- | --- | --- |
| `current_price(stock)` | 그 해 연말 확정가(스칼라, 라운드 중 안 바뀜) | `team_equity`·`round_snapshots`·`settle_options_round`·과거 라운드 차트 → "리더보드는 연도 넘길 때만 바뀐다" 규칙 유지 |
| `private.exec_price(stock)` | 경로의 지금 스텝 값(경로 없으면 `current_price`로 폴백) | `place_order`·옵션 스팟(`live_tick_price`)·`gameData.execPriceOf()` → 차트 팁·주문 예상금액 |

### 트랙 1 — 엑셀 / 수동 입력 → 브라운 브리지 (자동)

`stocks.prices`가 엑셀 업로드·[종목·가격] 탭 편집 등으로 바뀌면 DB 트리거(`stocks_bridge_paths`)가 자동으로 그 연도(+시작점이 이동한 다음 연도)의 252스텝 경로를 결정론적 기하 브라운 브리지로 보간해 저장한다(`source='bridge'`).

* 시작점 = 직전 연도 연말가, 끝점 = 입력한 연말가를 정확히 고정 → 재무·시황·힌트 시나리오 100% 보존.
* 시드 = `종목:연도` → 새로고침·다른 학생 화면에서 동일. 난수는 `private.tick_mulberry32_seq` + Box–Muller.
* 변동 강도 `private.bridge_path(..., p_sigma default 0.0045)` — 장중 대략 ±4~6%. 이 값은 실제 강사·학생과 한 판 돌려보고 튜닝하는 캘리브레이션 노브다.

### 트랙 2 — 주가 생성기 → raw 엔진 경로

관리자 [주가 생성기] 탭에서 "다음 라운드만" / "전체 연도 생성"을 실행하면 7팩터/GARCH/점프확산 엔진(`simulateNextRound` / `generatePriceSeries`, `returnPath: true`)의 raw 252스텝 경로를 그대로 저장한다(`source='engine'`, 핀·선형보정 없음). 각 경로의 마지막 값이 `stocks.prices`에 연말 확정가로 dual-write된다.

* `admin_apply_simulated_prices(secret, prices, paths, year)` — `paths` 형태 2종: `{sid: [252]}` + `year`(단일) / `{sid: {year: [252]}}`(다연도 배치).
* 이 RPC는 실행 중 `app.skip_bridge='1'`을 세워 트리거를 잠재운다(엔진 경로가 브리지로 덮이지 않게).

### 어느 트랙인지 확인

관리자 [진행] 탭 → "라운드별 시세 생성 방식" 섹션에서 라운드마다 📊 엑셀·브리지 / 🧮 수학엔진 / ⚠ 혼합 뱃지로 표시된다. DB에서는:

```sql
select year, source, count(*) from stock_price_paths group by year, source order by year;

```

### 초기화 / 재보간

```bash
node scripts/regen-bridge-paths.mjs           # 전 종목·연도를 SQL 브리지로 (source='engine'은 보존)
node scripts/regen-bridge-paths.mjs --force   # 엔진 경로까지 전부 브리지로 덮음

```

---

## 배포

프론트만 정적 호스팅하면 된다(백엔드는 Supabase 클라우드). Vercel: 저장소 Import → Framework=Vite 자동 (`npm run build` → `dist`), 환경변수 두 개(`VITE_SUPABASE_URL`·`VITE_SUPABASE_ANON_KEY`)만 등록. 관리자 비밀번호는 번들에 없으니 등록 불필요.

* 이 병합본을 배포하려면 장중 마이그레이션이 적용된 DB의 ref/anon key를 넣어야 한다(현재는 dev).
* Keep-Alive: 무료 플랜은 ~1주 무요청 시 DB를 재우므로 `.github/workflows/keepalive.yml`가 매일 핑을 보낸다(저장소 시크릿 `SUPABASE_URL`·`SUPABASE_ANON_KEY` 필요).

---

## 게임 진행 (관리자, 요약)

1. [데이터셋] — 쓸 데이터셋을 불러오거나 [진행] 탭 드롭다운에서 고른다.
2. [주가 생성기](https://www.google.com/search?q=%EC%84%A0%ED%83%9D) — 장중 경로를 엔진으로 생성·적용. 안 하면 엑셀/데이터셋 값 기준 브리지 경로가 트리거로 자동 생성된다.
3. [조 관리] — 코드 방식이면 조·코드 배부. 자율 입장이면 [진행] 탭에서 [PIN 발급] 후 학생이 닉네임+PIN으로 직접 입장(입장 방식은 [시스템] 탭 게임 설정에서 선택).
4. [진행] → [대회 시작](https://www.google.com/search?q=R1) → 순위 확인 → [타이머 시작](https://www.google.com/search?q=10%EB%B6%84)으로 거래를 연다.
5. 학생 즉시 매매(현물 + 옵션) → 타이머 만료로 자동 마감. (우측 하단 진행 패널로 어느 탭에서든 조작 가능.)
6. [다음 연도로 넘어가기] → 다음 해 가격 공개 + 순위 변동 + (R2부터) 힌트 자동 배분 + (엔진 트랙이면) 자동 상장·옵션 정산 → 다시 [타이머 시작]. 반복.
7. [대회 종료] → 최종 정산 연도 가격으로 최종 정산 + 전 학생 종료 모달. [리더보드] → [결과 내보내기].

### 대회 전 체크리스트

* [ ] 리허설 1회 — 가짜 라운드로 시작→타이머→매매→다음연도→정산→종료를 끝까지. 통합 버그는 여기서 나온다.
* [ ] [시스템] 탭 → [게임 리셋] — 테스트 조·거래·힌트 지급 초기화 (RESET 타이핑 확인).
* [ ] 진짜 데이터셋 로드 → [진행] 탭 시세 출처 뱃지로 전 라운드 경로 상태 확인 (필요 시 `regen-bridge-paths.mjs`).
* [ ] 진짜 조·참가코드(또는 게임 PIN) 세팅.
* [ ] 대회 창 동안 같은 DB에 다른 개발 작업 동결 (프로젝트가 하나뿐).
* [ ] `node scripts/verify-intraday-step-parity.mjs` — 스텝 인덱스 JS↔SQL 일치 (56/56).

---

## 구조

상태 흐름은 단방향. 서버 상태는 `App.jsx`(학생) / `Admin.jsx`(관리자)만 들고, 하위 컴포넌트는 props로만 값을 받는 순수 표시 컴포넌트다. 조작은 전부 `actions.js` 함수를 호출해 위로 올린다([CLAUDE.md](CLAUDE.md)).

```
src/
  App.jsx             최상위 (?admin이면 관리자, 아니면 학생). 상태·모달 오케스트레이션
  supabase.js         Supabase 클라이언트 + rpc/select/invokeFn 래퍼 + 에러 문구
  gameData.js         서버 상태를 화면용으로 가공(buildStocks·execPriceOf), 실시간 신호 구독(재접속 재동기화 포함)
  actions.js          상태를 바꾸는 동작(학생·관리자). 전부 async {ok, error}
  auth.js             입장 (login_team=코드 / join_team=자율 입장 닉네임·PIN)
  account.js          평가금액·손익 계산
  chart.js            좌표 계산 + 장중 경로 보조 — roundStepIndex(진행률→스텝) · downsample · priceAxis
  payoff.js           옵션 페이오프 계산
  metrics.js          재무·시황 지표 정의 단일 소스 (모달·편집·엑셀 파서가 참조)
  distribute.js       힌트 자동 배분 (등급순 × 순위 라운드로빈)
  dataCheck.js        콘텐츠 정합성 검사 (관리자 [데이터 점검])
  data.js             자동 생성 — 새 DB 초기 템플릿 + 테스트 원천
  format.js draw.js theme.js useSize.js main.jsx
  components/         학생 화면
    Chart.jsx         252 경로를 진행률만큼 드러내는 차트 (틱/일/주/월/년 = 다운샘플·윈도우)
    OrderSheet.jsx    현물 주문 — 장중 체결가·예상금액·현재 가상일차 표시
    StockList.jsx     종목 목록 — 1주(5스텝) 수익률 + 주 경계 플래시
    ModeTabs OptionOrderPanel PayoffDiagram VolatilitySmileModal   파생·헷지
    Header FinancialModal MarketModal HintModal RankingModal RoundModal FinalModal
    BroadcastModal EmergencyBroadcast Modal Toast QtyStepper RoundTimer ThemeToggle
    DrawLayer RotateNotice MyModal Login
  admin/              관리자 화면
    Admin.jsx         셸 + 4-그룹 탭 + 실시간 연결 상태 + FloatingRoundDock
    AdminHeader.jsx   상단 고정 상태바 (라운드·타이머·거래상태·입장 조 수·연결 인디케이터)
    AdminProgress.jsx [진행] — 라운드 진행·타이머·속보 + 시세 생성 방식 뱃지
    AdminSystem.jsx   [시스템] — 게임 설정·데이터 점검·게임 리셋 (되돌리기 어려운 작업 격리)
    AdminSimulator.jsx [주가 생성기] — 7팩터 엔진, "다음 라운드만" / "전체 연도" + 미리보기 차트
    AdminStocks AdminContent AdminDatasets AdminHints AdminTeams AdminBoard
    AdminOptions AdminAnalytics
    priceSim.js       확률과정 엔진 (simulateNextRound / generatePriceSeries, returnPath 지원)
    simulatorPresets.js macroNews.js newsService.js sectorTaxonomy.js PreviewChart.jsx
    datasetXlsx.js    엑셀 양식 ↔ 데이터셋 왕복
supabase/
  migrations/         0001~0045. 순서대로 적용 — 각 파일 헤더 주석이 그 변경의 근거
  functions/generate-breaking-news/index.ts   AI 속보 Edge Function (Gemini + 폴백)
  seed.sql            자동 생성 — 직접 고치지 말 것
scripts/
  apply-migrations.mjs            마이그레이션 SQL을 Management API로 직접 적용 (CLI 없이)
  regen-bridge-paths.mjs          전 종목·연도 브리지 경로 재생성 (--force로 엔진 포함)
  verify-intraday-step-parity.mjs 스텝 인덱스 공식 JS ↔ SQL 대조
  verify-auto-listing.mjs         자동 상장 로직 검증
  verify_game.mjs                 5라운드 실 DB 시뮬 (--yes, reset 포함 — 대회 중 금지)
  build-data.mjs gen-seed.mjs     JSON → data.js → seed.sql
sim_sandbox/         주가 시뮬레이터 실험장 (앱 빌드와 무관)
    market_sim.py                 확률과정 모델(파이썬 원본)
    stock_generator.py mean.py add_new_sim.py   Streamlit 데이터 생성기
    priceSim.js verify.js stress_test.js server.js index.html   브라우저 검증용 JS 포트
docs/                문서 (위 "문서 지도" — 일부는 병합/장중 이전 기준)

```

---

## 테스트

```bash
npm test    # Vitest — 현재 174 통과

```

순수 계산(차트 좌표·스텝 인덱스·힌트 배분·평가금액·엔진 경로·다운샘플)과 핵심 컴포넌트(Chart·OrderSheet·StockList·QtyStepper·AdminSimulator·FloatingRoundDock)를 커버한다. DB가 필요한 검증은 `scripts/verify-*.mjs` (Management API 경유, 게임 상태 미변경).

```

*참고: 캡처 이미지는 저장소 내 `docs/images/wts-trading-preview.png` 경로에 저장해 두시면 README 상단에 자동 렌더링됩니다.*

```
