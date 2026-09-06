# 현황 스냅샷 (STATUS)

> **갱신: 2026-09-06** · 게임 모델 **v3**(즉시 체결 + 라운드 타이머) + **재무제표 v4**(입력 7 + 파생) +
> **콘텐츠 전면 DB 이관** + **데이터셋 엑셀 왕복** + **자율 입장/공용 게임 PIN** + **배포** 기준.
> **2026-08-21 이후 개발 DB를 분리**하고 그 위에서 **시황 8지표 개편 · 장중 252스텝 가격경로 · 주가 생성기 ·
> 파생/옵션 · 재무·힌트 자동 정합 · Gemini 문장 생성 · 관리자 통계**를 얹었다(0033~0049, **프로덕션 미적용**).
> 이 문서는 "지금 이 순간 무엇이 있고 무엇이 없나"의 완전한 스냅샷이다. 외부 검수·내년 인수인계용.
> 판단의 *이유*는 [DECISIONS.md](DECISIONS.md), 게임 *규칙*은 [GAME_RULES.md](GAME_RULES.md),
> *화면*은 [SCREENS.md](SCREENS.md), *데이터 교체*는 [DATA_GUIDE.md](DATA_GUIDE.md)·[MANUAL_CONTENT.md](MANUAL_CONTENT.md),
> *대회 운영*은 [OPERATIONS.md](OPERATIONS.md), 강사 매뉴얼은 [MANUAL_ADMIN.md](MANUAL_ADMIN.md)를 본다.

한 줄 요약: **전 과정(로그인→매매→라운드 전환→자동 힌트→최종 정산)이 실측으로 돌고 Vercel에 배포돼
원격 플레이테스트를 마쳤다. 콘텐츠(재무·시황·힌트·주가)는 전부 DB의 데이터셋에 있고 관리자 화면에서
엑셀 양식/직접 편집으로 만든다. 8월 하순부터 개발 DB(`lynchogququuwihhixrd`)에서 장중 시세·옵션·주가
생성기·자동 정합을 추가했다 — 기능·테스트는 통과하나 아직 프로덕션 DB에 안 올라갔다. 남은 건 프로덕션
마이그레이션·콘텐츠 확정·실기기 검증·대회 전 초기화 리허설이다.**

---

## 0. 두 개의 DB (2026-08-21 분리) — ⚠ 먼저 읽는다

| | 개발 DB | 프로덕션 DB |
|---|---|---|
| 프로젝트 ref | `lynchogququuwihhixrd` | `zhwidhvoxcoljffvqhol` (`cufic_wts`, 서울) |
| 누가 붙나 | `supabase` CLI(link 대상), 로컬 `.env`(현재) | Vercel 배포(대시보드 env) |
| 마이그레이션 | **0001~0049 전부** | **0001~0032까지만** |
| 콘텐츠 | 최신 데이터셋(8지표·장중 경로) | 8월 중순 상태(6지표·연말가 스칼라) |

- **로컬 env가 하나뿐이다.** `.env`가 dev DB를 가리키고, prod 값은 `.env.prod-backup`(Vite가 안 읽는 파일명)에 있다.
  지금은 `npm run dev`·`vite build` 둘 다 dev DB에 붙는다.
- **0033~0049의 기능(아래 §1-B)은 프로덕션 라이브에 없다.** `main` push는 프론트만 재배포한다 —
  스키마는 `npx supabase db push`를 prod 대상으로 따로 돌려야 따라온다.
- **대회 전 필수** — prod에 0033~0049 push → 재시드 → `reset_game` → 실기기 리허설. §6-2 참고.

---

## 1. 전체 진행률

### ✅ A. 완료 (동작 확인됨 · 두 DB 공통 / 0001~0032)

**백엔드 (Supabase)**
- 마이그레이션 **0001~0032** 두 DB 모두 적용. 스키마 재현 가능(대시보드 수동 편집 없음).
- **즉시 체결 + 라운드 타이머** — `place_order`가 그 자리에서 체결, `now() < round_ends_at`을 서버가 강제.
- **게임 루프** — `advance_round`(연도 넘기기) → `start_round_timer`(거래 창 열기) → 자동 마감. 진행 중 `adjust_round_timer`로 ±조정(0019).
- **자동 힌트 차등 지급(라운드로빈, 0025)** — R2부터 `distribute_round_hints`가 힌트 풀을 등급순 정렬 후
  **꼴찌부터 라운드로빈**으로 전부 배분(하위권일수록 좋은 힌트 + 더 많이). 수동 지급 보조.
- **콘텐츠 전면 DB화** — 재무제표(`financials`)·거시 시황(`macro`)이 DB에 있고 관리자 화면에서 직접 편집.
  학생용 `get_financials`/`get_macro`는 **현재 라운드 연도까지만** 반환(미래 스포일러 차단).
- **데이터셋(시나리오)** — `datasets` 테이블 + 저장·불러오기·가져오기/내보내기. `game_state.active_dataset_id`가
  지금 쓰는 한 벌을 가리킨다. 불러오기는 게임 리셋을 동반(조 유지), 진행 중엔 잠금.
- **데이터셋 엑셀 왕복** — 공식 양식(.xlsx) 다운로드/업로드로 콘텐츠 한 벌을 통째로 편집. 업로드는 3단계 리포트
  후 **항상 새 데이터셋 생성**. JSON 가져오기/내보내기도 지원. `src/admin/datasetXlsx.js`(SheetJS 동적 로드).
- **자율 입장(open, 0028) + 공용 게임 PIN(0030)** — `game_state.join_mode`(`code`|`open`)로 전환. open이면 학생이
  **닉네임 + 공용 게임 PIN**으로 입장/재접속(`join_team`, Kahoot식). 공용 PIN은 강사가 시작 전 무작위 4자리 발급
  (`admin_set_game_pin`), `private.config('game_pin')`에 저장(anon이 못 읽음). `reset_game`이 초기화(0032).
- **최종 정산** — `admin_end_game`이 `final_year` 가격을 공개하고 스냅샷. 떠나는 라운드·최종 두 지점 모두 기록(0017).
- **조 접속 추적(0027)** — `login_team`/`join_team` 성공 시 `teams.last_login_at` 기록, `admin_teams_status`가 함께 반환.
- **리더보드 동률 결정론(0029)** — 평가금액 동률이면 조 생성순(`created_at`)으로 안정 정렬.
- **실시간** — `signals` 테이블 + Realtime. 신호 수신 → 각자 RPC 재조회.
- **관리자 보호** — 관리자 RPC 전부 `p_admin_secret` + `private.verify_admin`. 비밀은 `private` 스키마, fail-closed.

**배포 / 운영**
- **Vercel 배포** — <https://cufic-wts.vercel.app> (GitHub `ms4317/cufic-wts`, public, main push 시 자동 재배포).
- **원격 플레이테스트 완료** — 친구 5명 각자 접속, 로그인·매매·관리자 조작 점검.
- **Keep-Alive 가동** — `.github/workflows/keepalive.yml`이 매일(UTC 04:17) REST 핑으로 무료 플랜 일시정지 방지.
  저장소 시크릿(`SUPABASE_URL`·`SUPABASE_ANON_KEY`) 설정 완료, 수동 실행 성공 확인.

**학생 화면**
- **입장 2방식** — 참가 코드(서버 검증) 또는 **닉네임 + 공용 게임 PIN(자율 입장)**. 새로고침 자동 재로그인 · 로딩/실패/오프라인 처리.
- 즉시 매수·매도(비율 버튼·수량 스테퍼) · 거래 타이머 카운트다운 · 타이머 밖 버튼 잠금.
- **거래 타이머(`RoundTimer.jsx`: `TimerPill`)** — 헤더 필(라벨+시간+진행바, 학생·관리자 공통). 여유=골드 / 60초↓=경고 /
  30초↓=긴급(빨강+점멸+발광) + 30초 토스트(1회). 두 테마. 진행바 기준값=`round_duration_seconds`.
- **상장폐지 보유 경고** — 주문 패널 보유행·MY 보유표·라운드 요약에 "⚠ 상장폐지 · 전액 손실".
- 힌트(헤더 버튼 → 팝업, 등급 S~D, 내 조 것만, 도착 토스트).
- **시황판(거시경제)** — 헤더 📈 시황 → 연도별 지표 표(현재 연도까지). 배경 정보(인과 미적용).
- 차트(결정론적 캔들·추세선 그리기) · 재무제표(연도 스포일러 차단) · MY 계좌(보유/체결/수익률 차트).
- 조별 순위 팝업 · **라운드 전환 요약**(평가금액 변동 + 순위 "5위→3위" 변동 + 상장폐지 경고) · 대회 종료 모달 · 속보 팝업.
- **로고** — CUFIC 심볼 PNG(헤더·로그인·파비콘), 다크 테마용 리컬러 변형 자동 스왑. 종목 코드 숨김.
- 다크/라이트 · 태블릿 대응(44px 터치·세로 회전 안내).

**관리자 화면 (`/?admin=1`)**
- **4탭 그룹 / 11탭** — [게임 운영] 진행·리더보드 / [시세·상품] 종목·가격·파생·옵션·주가 생성기 /
  [참가자·현황] 조 관리·통계 / [콘텐츠·시스템] 데이터셋·재무·시황·힌트·시스템. 탭마다 한 줄 도움말.
- **상단 고정 상태바(`AdminHeader.jsx`)** — 라운드/타이머/조 접속 수 한눈 요약.
- **진행** — 시작 전 대회 준비 카드(①데이터셋 ②입장 PIN 발급 ③입장 확인 ④대회 시작, PIN 미발급 가드) →
  시작 후 다음 할 일·연도 넘기기·타이머 시작(**설정값**·±1분)·대회 종료·속보·거래 현황 · (대회 준비) 게임 설정·데이터 점검·리셋.
- **리더보드** — 순위·순위 변동 ▲▼·단독 1위 골드·프로젝터용 큰 글씨 · **[대회 결과 내보내기 CSV]**(3구획, UTF-8 BOM).
- **조 관리** — code: 코드로 조 추가/삭제. open: 게임 입장 PIN 카드([발급]/[재발급]) + 실시간 입장 목록 + 이름 인라인 수정.
  공통: 시드[시작 전만]·예수금/평가/수익률/거래/힌트 + 접속 열(최근 10분).
- **데이터셋 / 종목·가격 / 재무·시황 / 힌트** — CRUD + 엑셀·JSON 왕복 + 자동 배분 미리보기(호재/악재↔등락 불일치 경고).

**데이터 / 품질**
- 2025 기반 초안 데이터(**18종목 · 5라운드 2020~2024 · 최종 2025**). `src/data.js`는 "초기 템플릿"(데이터셋 시딩용 생성물).
- **Vitest 225개 / 20파일 전부 통과**. `verify_game.mjs`로 5라운드 실 DB 시뮬레이션 통과.
- 콘텐츠 정합성 점검(`dataCheck.js`)이 관리자 [데이터 점검]으로 노출(호재/악재↔등락·힌트 누락·가격 공백).

### 🟩 B. 개발 DB에만 (0033~0049 · 프론트는 main에 병합·Vercel 배포됨, **prod DB 미적용**)

- **시황 8지표 개편 (0033~0034)** — `코스피·S&P500·니케이·유럽 / 기준금리·물가·유가·금`.
  `gdp·unemployment·fx`는 표시에서 뺐으나 컬럼은 비파괴 보존. 정의는 `src/metrics.js`(`MACRO_METRICS`) 단일 소스.
- **주가 생성기 (0035, `admin_apply_simulated_prices`)** — 7팩터 거시모델·GARCH(1,1)·머튼 점프확산 엔진
  (`src/admin/priceSim.js`, 외부 의존성 0). 계산은 브라우저, RPC는 **여러 종목을 한 트랜잭션으로 원자 반영**만.
  전체 탭(`AdminSimulator.jsx`) + 진행 탭의 빠른 생성(`FloatingRoundDock.jsx`), 프리셋 공유(`simulatorPresets.js`).
  - **분기별(63일) 거시 파라미터 (2026-09-06 · 엔진·UI 마이그레이션 없음 / 서버 저장 0048)** —
    한 라운드(=1년=252일)를 4분기로 나눠 **63일 경계마다 거시 7요인(금리·GDP·실업·물가·소비심리·환율·유가)을
    통째로 교체**. `simulateNextRound`/`generatePriceSeries`의 선택적 `quarters:[{macro,eventNews,hintText}×4]`.
    금융위기는 별도 코드 없이 그 분기에 금리 급등+GDP 역성장을 넣으면 `step()`의 Δ 충격 + 임계치 변동성
    급등으로 자연히 나온다(옛 drift·σ 스칼라 방식은 폐기). 가격 연속, 252일째=연말 확정가 불변. **미지정 시
    기존 결과와 바이트 동일**(하위호환 테스트). 순수 기하는 `src/quarters.js`, config 기본값·검증은
    `src/admin/quarterConfig.js`, 슬라이더 메타는 `src/admin/macroFields.js`, 프리셋은 `QUARTER_PRESETS`
    (완만한 성장 / 2분기 위기·4분기 반등 / 박스권 / 완만한 하락).
  - **AdminSimulator "시장 흐름 설정" 카드 (토스풍 리디자인, 2026-09-07)** — 세그먼트 3다이얼:
    **경기**(GDP·실업·심리) / **금리·물가** / **대외 여건**(환율·유가), 각 3~5단(`매우 나쁨`…`매우 좋음`),
    실제 숫자는 아래 작게 병기. `[라운드 내내 한 흐름 | 분기마다 바뀜]` 토글. 분기 모드: 스토리 프리셋 카드
    (미니 라인) → 4분기 요약 스트립(`보통 → 매우 나쁨 → …`, = 분기 선택기) → 선택 분기 3다이얼. `정밀 조정 ▾`
    (`<details>`)에 숫자 그리드 보존. 손잡이 매핑 `src/admin/macroLevels.js`, `Segmented` 컴포넌트 + `.seg`(admin.css
    "토스 레이어"). `QUARTER_PRESETS`는 레벨 id로 정의(`macroFromLevels`) → 불러오면 세그먼트가 딱 맞게 켜짐.
    **관리자 화면 전반 리디자인의 기준 화면 — 나머지 10탭은 후속**([DECISIONS.md](DECISIONS.md) 2026-09-07).
  - **학생 화면 장중 분기 표시·전환 알림** — 헤더에 `Q2 · 5월` 배지(`liveStep`→`quarterOfStep`/`monthOfStep`,
    거래 중에만). Q1→Q2→Q3→Q4 전환 시 속보/힌트 토스트 1회(`qPrev` ref 중복 방지, 라운드 중간 접속 시 소급 발사 없음).
  - **분기 config 서버 저장 (0048, 개발 DB 적용됨 · 클라이언트 배선 완료)** — `round_quarter_configs`
    (round PK, `quarters` jsonb[4], 길이만 CHECK. RLS on, select 정책 없음 — 미래 분기 macro 스포일러 차단,
    `round_configs`(0038) 원칙). 관리자 RPC 3개(upsert/list/delete, `actions.js` 래퍼). 학생 RPC
    `get_quarter_events()` — 현재 라운드·현재 분기(`private.round_step_idx()`)까지만 `{quarter,eventNews,hintText}`
    (macro는 학생에게 안 줌). `snapshot_content`/`restore_content`에 `quarter_configs` 키(옛 payload null-safe).
    - **배선** — `AdminSimulator` [적용] 시 `persistQuarters()`가 대상 라운드(next=다음 / batch=전 라운드)에 저장.
      `App.jsx` 토스트는 전환 직후 `get_quarter_events()` 재조회로 **서버 값 우선**, 없으면 `quarterEvents.js` 폴백.
      재무 파생은 [사용] 시 Q4(연말) macro 금리·물가 사용. REST 왕복 검증 완료. 남은 것: 저장값 되불러오기 UI 버튼.
- **장중(인트라데이) 가격 경로 (0043~0045)** — 라운드 = 1년 = **252 일별 스텝**을 `stock_price_paths`에 저장.
  - 체결(`place_order`)·옵션 스팟 → `private.exec_price`(경로의 현재 스텝, 없으면 폴백). `start_round_timer`가 `round_start_at`을 세워 진행률 기준점을 잡는다(0044).
  - 평가·정산·과거 차트 → `current_price`(연말 확정가 스칼라, **불변**) — 리더보드는 여전히 연도 전환 때만 움직인다.
  - **2트랙 생성 (0045)** — 트랙1: 엑셀 업로드·수동 편집 → 트리거가 기하 브라운 브리지로 연도 사이 보간(양 끝 고정, 시나리오 100% 보존, `source='bridge'`). 트랙2: 주가 생성기 → 엔진 raw 252스텝을 그대로(`source='engine'`), 마지막 값을 `stocks.prices`에 dual-write.
  - 옛 벽시계 흔들림 `private.tick_price`(0036~0037)는 폐기 — 함수는 호환용으로 남고 아무도 호출 안 함.
  - **거래 타이머 일시정지/재개 (0049)** — `pause_round_timer`/`resume_round_timer` + `game_state.round_paused_at`.
    일시정지 중: 카운트다운·`round_step_idx()`가 그 시각에서 얼고 `place_order`는 `round_paused`로 거부.
    재개 시 멈춘 만큼 `round_start_at`·`round_ends_at`을 뒤로 밀어 남은 시간·진행률이 그대로 이어짐. `is_locked`와 별개 상태.
    관리자 진행 탭에 [⏸ 일시정지]/[▶ 재개] 버튼, `TimerPill`에 `paused` 상태(앰버·`⏸ m:ss`). 클라 `roundStepIndex`도 동일 공식.
- **파생·옵션 (보호적 풋) (0041~0042)** — **롱 매수만**(네이키드 매도는 증거금 없이 교육용에 부적합).
  블랙-숄즈(`private.norm_cdf`, A&S 7.1.26 근사), σ·r은 계약 생성 시 관리자 입력. 표준 옵션 **자동 상장** —
  라운드 N이 열리면 그 종목 현재가를 행사가로·만기 N+1로 상장, 다음 `advance_round`가 `settle_options_round`로 자동 정산.
  학생: `ModeTabs`(현물↔파생)·`OptionOrderPanel`·`PayoffDiagram`(`src/payoff.js`)·`VolatilitySmileModal`.
  RPC `quote_option_premium`·`place_option_order`·`admin_upsert_options_contract`·`admin_deactivate_options_contract`.
  관리자: [파생·옵션] 탭(`AdminOptions.jsx`). ELS(구조화 상품) 기초는 0042에 스키마만.
- **재무·힌트 자동 정합 (0047, `admin_apply_generated_content`)** — 주가 생성기로 가격을 바꾸면
  `deriveNextFinancials`(`src/metrics.js`)·`deriveRoundHints`(`src/distribute.js`)가 재무 7입력·힌트 impact/grade/related를
  **결정적으로 재산출**. `buildDerivedContent`(`src/admin/simContent.js`)가 self-check(힌트↔등락 방향)를 돌려
  어긋나면 [적용]을 잠근다. 응답 계수는 `DEFAULT_FIN_MODEL`. 상세 [DECISIONS.md](DECISIONS.md) 2026-08-30.
- **Gemini BYO 키 문장 생성 (마이그레이션 없음, 배포 불필요)** — 관리자가 자기 Gemini 키를 비번으로 잠긴
  화면에 붙여넣으면 브라우저가 Google을 직접 호출. 키·모델명 모두 그 브라우저 `sessionStorage`에만(탭 닫으면 소멸).
  숫자·방향은 절대 안 건드리고 **헤드라인 문장만** 교체. `src/admin/gemini.js`·`hintService.js`·`newsService.js`.
  기본 모델 `gemini-3.6-flash`, 주가 생성기 탭 **[모델] 칸**으로 교체 가능(Google이 몇 달마다 갈아치움). 호출 실패 시 Google이 준 에러 본문을 화면에 그대로 노출.
  우선순위: 직접 호출 → Edge Function(`supabase/functions/generate-breaking-news`) → 규칙 템플릿(`macroNews.js`).
- **관리자 참가자별 매매 통계 (0046)** — `admin_teams_status`에 `trades_total`·`buy_count`·`sell_count`·`volume`·
  `realized_pnl`·`holdings_count` 추가(시그니처 유지, 키만 추가). [통계] 탭(`AdminAnalytics.jsx`), 실시간 갱신.
- **DB 초안 — 스키마만, 호출하는 화면 없음** (prod에 올릴지 결정 대기):
  - `round_configs` (0038) — 라운드별 거시 시뮬 파라미터 서버 저장(감사·재현용). RLS select 정책 없음(스포일러 차단).
  - 행동 텔레메트리 + 투자성향(MBTI)·배지 (0039) — `game_trade_logs`(append-only) + 집계 RPC. `log_event` 프론트 미연결.
  - 예금(고정금리 복리) + 최종 벤치마크 비교 (0040) — `savings_products`·`user_savings`, `team_equity` 재정의 포함. `open_savings`/`withdraw_savings` 프론트 미연결.

### 🟡 C. 진행 중 / 확정 대기

- **콘텐츠 검토** — 재무 수치·힌트 문구·종목 소개는 팀 검토 전 초안. 구조 확정, 값 미확정.
- **인과 엔진(거시지표→주가 자동 반영)** — 미적용. 현재 시황판은 배경 정보. (주가 생성기는 관리자가 수동으로 매크로를 넣는 방식.)
- **관리자 비밀번호 강화** — 현재 개발 기본값(약함). 실전용 강한 값으로 교체 대기.
- **순위 상시 노출 여부** — 팀 결정 대기(현재는 팝업 + 리더보드 탭).
- **0038~0040(round_configs·텔레메트리·예금)** — 대회에서 쓸지 미정. 쓰면 UI 필요, 안 쓰면 prod에 안 올리는 게 깔끔.

### ⬜ D. 미착수

- **프로덕션 DB에 0033~0049 적용 + 재시드** — §6-2.
- **실기기 태블릿 테스트** — 실제 터치·그리기·회전(지금은 헤드리스만).
- **대회 전 초기화 리허설** — `reset_game` + 검증용/플레이테스트 조 정리 실측(→ OPERATIONS).
- **봉 주기 실데이터화** — 일/주/월은 아직 같은 1년 구간(장중 경로는 "년" 해상도에만 반영).
- **파일 정리** — `index.css` 분리(리팩터, 후순위).

---

## 2. 파일 지도

> 전 파일 1줄 설명. 자동 생성 파일(`src/data.js`·`supabase/seed.sql`)은 직접 편집 금지.

### `src/` — 진입점·유틸
| 파일 | 역할 |
|---|---|
| `main.jsx` | React 진입점. `App`을 `#root`에 마운트, `index.css`·`admin.css` 로드 |
| `App.jsx` | 최상위. `?admin`이면 관리자, 아니면 학생 화면. 학생 상태·데이터 로드·실시간 신호·모달 오케스트레이션·현물/파생 모드 전환 |
| `account.js` | 계좌 파생 순수함수. `deriveAccount`(평가금액=예수금+보유평가, 총손익), `positionPnl` |
| `payoff.js` | 보호적 풋 손익 순수함수(`spotPnlPerShare`·`buildPayoffSeries`·`floorLoss`·`breakeven`). `PayoffDiagram`이 사용 |
| `chart.js` | 종목별 결정론적 캔들 생성(`candleSeries`), 봉주기(`TIMEFRAMES`), 이동평균(`movingAverage`) |
| `draw.js` | 차트 낙서 기하 순수함수. 점-선분 거리(`distToSegment`), 지우개 판정(`strokeHit`) |
| `format.js` | 숫자·부호·방향 포맷(`num`,`signed`,`pct`,`dirOf`,`arrowOf`,`eok`,`nowTime`). 한국 증시 색 관례 |
| `gameData.js` | 서버 상태→화면 가공. `yearOf`,`buildStocks`,`loadAll`,`refetchMine`,`subscribeSignals`(재무·시황·데이터셋 신호 포함) |
| `supabase.js` | Supabase 클라이언트 + `rpc`/`select` 래퍼(`{ok,error}`) + 거부 사유→한국어(`errorText`) |
| `auth.js` | 입장(`login_team`=코드 / `join_team`=자율 입장 닉네임·PIN), localStorage 저장, 자동 재로그인(`restore`), `logout` |
| `theme.js` | 다크/라이트 테마 훅(`useTheme`). `<html data-theme>` + localStorage |
| `useSize.js` | `ResizeObserver`로 엘리먼트 실측 크기 추적(SVG viewBox 정합) |
| `actions.js` | 상태 변경 동작. 학생 `makeActions`(placeOrder·옵션), 관리자 `makeAdminActions`(매 호출 `p_admin_secret`) |
| `dataCheck.js` | 콘텐츠 정합성 검사(`checkContent`·`hintMismatches`). 관리자 [데이터 점검]이 사용 |
| `distribute.js` | 힌트 라운드로빈 배분(`sortPool`·`rankWorstFirst`·`assignRoundRobin`·`distribute`) + `deriveRoundHints`(생성기 자동 정합) |
| `metrics.js` | **재무·시황 지표 정의 단일 소스**. `FIN_INPUTS` 7 + `FIN_DERIVED` + `deriveFinancials()` + `deriveNextFinancials()` · `MACRO_METRICS` 8. `data.js`가 재수출 |
| `data.js` | **자동 생성**. 데이터셋 초기 템플릿 + 재무제표 모달·정합성 테스트의 공통 원천 |
| `index.css` | 학생 화면 스타일 + 테마 CSS 변수(다크/라이트). 색 하드코딩 금지 |
| `admin.css` | 관리자 화면·보유목록·부팅/로딩/에러 스타일 |

### `src/` — 테스트 (20파일 / 225개)
| 파일 | 커버 |
|---|---|
| `account.test.js` | `deriveAccount`·`positionPnl`(평가금액 파생, 거래정지 −100%, 0 나눗셈 방지) |
| `payoff.test.js` | 보호적 풋 손익·손실 하한·손익분기(순수함수 직접 검사) |
| `chart.test.js` | `candleSeries`·`movingAverage`(차트 방향 = 실제 등락, 결정론성, 회귀) |
| `draw.test.js` | `distToSegment`·`strokeHit`(지우개 선분 판정, 회귀) |
| `data.test.js` | 데이터 정합성(종목·힌트·재무·라운드 전수, **호재/악재 태그↔다음 해 등락**) |
| `distribute.test.js` | 힌트 라운드로빈(꼴찌부터 배분·하위권 우대·전량 소진) |
| `metrics.test.js` | `deriveFinancials`(항등식·자본잠식) + `deriveNextFinancials`(생성기 재무 산출) |
| `gameData.test.js` | 서버 응답→화면 모양 가공 |
| `components/Chart.test.jsx` · `StockList.test.jsx` · `QtyStepper.test.jsx` | 렌더·상호작용(회귀) |
| `quarters.test.js` · `quarterEvents.test.js` · `admin/quarterConfig.test.js` | 분기 경계(63/64, 126/127, 189/190)·`quarterOfStep`·`monthOfStep` · 분기 이벤트 config 덮어쓰기 · `defaultQuarterConfigs`/`isValidQuarterConfigs`/`normalizeQuarterConfigs` |
| `admin/AdminSimulator.test.jsx` · `FloatingRoundDock.test.jsx` · `priceSim.test.js` · `simContent.test.js` · `hintService.test.js` · `gemini.test.js` | 주가 생성기 엔진(분기 레짐 연속성·불변식·전환 포함)·미리보기·자동 정합·Gemini 경로 |

### `src/components/` — 학생 화면
| 파일 | 역할 |
|---|---|
| `Modal.jsx` | 공통 모달(딤·X·ESC·포커스 트랩·배경 스크롤 잠금, `wide` 옵션) |
| `Toast.jsx` | 토스트 훅(`useToasts`)·렌더러(자동 소멸, 클릭형 지원) |
| `ThemeToggle.jsx` | 다크/라이트 토글 버튼(해·달 SVG) |
| `RotateNotice.jsx` | 세로 화면(1023px↓) CSS 회전 안내 오버레이(JS 감지 없음) |
| `DrawLayer.jsx` | 차트 위 그리기 SVG(펜·추세선·지우개, 좌표 0~1 정규화) |
| `QtyStepper.jsx` | 주문 수량 입력(−/+·직접입력·방향키·클램프)과 비율 버튼(`QtyRatios`) |
| `ModeTabs.jsx` | 주식 매매(spot) ↔ 파생·헷지(derivatives) 전환. 순수 UI 상태 |
| `Login.jsx` | 참가 코드/닉네임+PIN 입장 화면(로고 마크) |
| `Header.jsx` | 상단 헤더(로고·팀·라운드/"시작 전"·거래 타이머·**장중 분기 `Q2 · 5월` 배지**·순위·내 힌트·📈 시황·속보 종·계좌·테마·로그아웃) |
| `StockList.jsx` | 좌측 종목 목록(종목명·정렬·현재가·등락률·거래정지·상장예정 숨김·보유 표시)과 MY 열기 |
| `Chart.jsx` | 가운데 차트 패널(종목명·시장·재무 버튼·그리기·봉주기·캔들/MA/현재가선·장중 경로) |
| `OrderSheet.jsx` | 우측 주문 패널(즉시 체결 매수/매도·비율·예상금액·거래 안내·보유종목·상장폐지 경고) |
| `OptionOrderPanel.jsx` | 옵션(보호적 풋) 주문 패널 — 계약 선택·프리미엄 견적·수량 |
| `PayoffDiagram.jsx` | 옵션 포지션 손익 곡선(순수 SVG, `payoff.js` 기반) |
| `VolatilitySmileModal.jsx` | 변동성 스마일 설명 모달(순수 SVG) |
| `FinancialModal.jsx` | 재무제표 모달(소개 + 연도 탭 → T자형 재무상태표 + 단계차감 손익 + 파생 칩[부채비율·ROE, 자본잠식] + 용어 접기. 스포일러 차단) |
| `MarketModal.jsx` | 시황판 모달(연도별 거시 8지표·탭하면 지표 설명·현재 연도까지 공개) |
| `HintModal.jsx` | 내 힌트 팝업(등급·라운드·헤드라인·관련 종목. 호재/악재는 의도적 미표시) |
| `BroadcastModal.jsx` | 속보(공통) 목록 팝업, 최신순 |
| `EmergencyBroadcast.jsx` | 새 속보 도착 시 뜨는 재난문자식 강조 팝업 |
| `MyModal.jsx` | MY 계좌(요약 바 + 보유종목/체결내역/수익률 차트 탭. 상장폐지 배지) |
| `RoundModal.jsx` | 라운드 전환 요약(새 연도·평가금액 변동·순위 "N위→M위"·상장폐지 경고·보유 최고/최저 등락) |
| `FinalModal.jsx` | 대회 종료 모달(내 최종 순위·자산·수익률 + 전체 조 순위표·순위 변동) |
| `RankingModal.jsx` | 전체 조 순위 팝업(내 조 강조) |
| `RoundTimer.jsx` | `TimerPill` — 헤더 거래 타이머 필(학생·관리자 공통, 임박 색·30초 토스트) |

### `src/admin/` — 관리자 셸 + 11탭
| 파일 | 역할 |
|---|---|
| `Admin.jsx` | 관리자 셸(비밀번호 로그인·sessionStorage·실시간 구독·4그룹 11탭 네비·탭 도움말) |
| `AdminHeader.jsx` | 상단 고정 바 + 한눈 상태 요약(라운드·타이머·조 접속) |
| `AdminProgress.jsx` | 진행 탭(대회 준비 카드·다음 할 일·연도 넘기기·타이머 시작[설정값]·±1분·대회 종료·리셋·속보·거래 현황·게임 설정·데이터 점검) |
| `FloatingRoundDock.jsx` | 진행 탭에 떠 있는 빠른 주가 생성 도크(프리셋·간이 미리보기·적용) |
| `AdminBoard.jsx` | 리더보드 탭(순위·순위 변동·단독 1위 골드·큰 글씨 + 대회 결과 CSV 내보내기) |
| `AdminDatasets.jsx` | 데이터셋 탭(미저장 배지·저장/새로·엑셀·JSON 받기/올리기·편집 전환·삭제·검사 리포트 모달) |
| `datasetXlsx.js` | 엑셀 왕복(`parseWorkbook`·`buildWorkbook`·`buildBlankWorkbook`). 3단계 리포트. SheetJS 동적 로드 |
| `AdminStocks.jsx` | 종목·가격 탭(종목 CRUD·연도별 인라인 편집·0=거래정지·소급 안 됨 경고) |
| `AdminOptions.jsx` | 파생·옵션 탭(옵션 계약 CRUD·σ·r 입력·활성/비활성) |
| `AdminSimulator.jsx` | 주가 생성기 탭(매크로 슬라이더·프리셋·엔진 시뮬·미리보기 차트·재무·힌트 재생성 카드·self-check·적용) |
| `priceSim.js` | 확률과정 다자산 주가 엔진(GBM·GARCH(1,1)·머튼 점프확산·`generatePriceSeries`·`simulateNextRound`, 선택적 `quarters` 분기 레짐). 외부 의존성 0 |
| `quarters.js` | 분기(63일) 순수 기하 단일 소스(`QUARTER_LEN`·`QUARTER_STARTS`·`quarterAt`·`quarterOfStep`·`monthOfStep`·`isQuarterStart`) + JSDoc `QuarterConfig`(macro 7요인). 학생 화면도 import — 엔진 비의존 |
| `quarterEvents.js` | 학생 장중 분기 전환 시 띄울 속보/힌트 폴백 — 임시 클라이언트 config(`quarterEvent(round,quarter)`, 기본 문구 + `sessionStorage['wts-quarter-events']` 덮어쓰기). 서버 `get_quarter_events()` 실패·공백 시 대체 |
| `admin/quarterConfig.js` | 분기 config 기본값·검증(`defaultQuarterConfigs`·`isValidQuarterConfigs`·`normalizeQuarterConfigs`). 거시 기본값이 엔진에 있어 관리자 모듈에 분리 |
| `admin/macroFields.js` | 거시 7요인 슬라이더 UI 메타(`MACRO_FIELDS`·`MACRO_KEYS`) — 단일 거시 카드·분기 카드 공용 |
| `simContent.js` | 새 가격 경로 → 재무·힌트 결정적 재생성(`buildDerivedContent`) + self-check |
| `simulatorPresets.js` | 7요인 프리셋 + `QUARTER_PRESETS`(분기 레짐 프리셋). AdminSimulator·FloatingRoundDock 공용 |
| `sectorTaxonomy.js` | 한국형 업종 분류 + 색상 팔레트(비어 있으면 종목명 키워드로 추정 — 차트 가독성용) |
| `gemini.js` | 관리자 BYO Gemini 키 브라우저 직접 호출(`callGemini`·`hasGeminiKey`, sessionStorage 전용) |
| `hintService.js` | 힌트 헤드라인만 Gemini로 다듬기(impact·grade·related·round는 불변) |
| `newsService.js` | 라운드 시황 속보 문장 생성(Gemini, 실패 시 규칙 템플릿) |
| `macroNews.js` | 규칙 기반 시장 속보 후보 생성기(임계값 기반, Gemini 대체 경로) |
| `AdminAnalytics.jsx` | 통계 탭(참가자별 매매 지표·실시간 갱신) |
| `AdminContent.jsx` | 재무·시황 탭(연도별 시황 8지표 + 종목별 재무 입력 7개[잎]만, 파생값 옆에 실시간 계산) |
| `AdminHints.jsx` | 힌트 탭(풀 CRUD·조별 수동 지급/취소·자동 배분 미리보기·힌트 편집기) |
| `AdminTeams.jsx` | 조 관리 탭(open: 게임 PIN 카드·실시간 목록·이름 수정 / code: 코드로 조 추가. 시드·현황·접속 열) |
| `AdminSystem.jsx` | 시스템 탭(게임 설정·데이터 점검·리셋 등 저빈도 관리) |
| `PreviewChart.jsx` | 순수 SVG 다중 라인 차트(생성기 미리보기용, 외부 라이브러리 없음) |

### `scripts/` · `supabase/functions/` · `.github/`
| 파일 | 역할 |
|---|---|
| `build-data.mjs` | JSON(주가·재무) + 내장 소개·힌트 → `src/data.js` 생성 |
| `gen-seed.mjs` | `src/data.js` → `supabase/seed.sql` 생성(재적용 가능 DELETE+INSERT) |
| `apply-migrations.mjs` | Management API로 마이그레이션 일괄 적용(CLI 대안) |
| `verify_game.mjs` | 실 DB 5라운드 풀 시뮬레이션(`--yes` 필수, `reset_game` 하므로 대회 중 금지) |
| `verify-intraday-step-parity.mjs` | `private.exec_price` ↔ 프론트 스텝 계산 동일성 검증(0043/0044 push 전) |
| `verify-auto-listing.mjs` | 옵션 자동 상장·정산 시나리오 검증(0042) |
| `regen-bridge-paths.mjs` | `stock_price_paths` 브리지 경로 재생성(트랙1) |
| `audit-dataset.mjs` / `repair-dataset.mjs` | 임의 DB의 힌트↔등락 드리프트 감사 / 현재 가격 기준 재무·힌트 일회성 재생성 |
| `supabase/functions/generate-breaking-news` | 시황 기반 속보 Edge Function(Deno, Gemini). 미배포여도 규칙 템플릿으로 대체 |
| `.github/workflows/keepalive.yml` | 매일 Supabase REST 핑(무료 플랜 일시정지 방지). 시크릿 2개 필요 |

### 루트 / 문서
| 파일 | 역할 |
|---|---|
| `package.json` | npm(dev/build/test), React 18·@supabase/supabase-js, Vite 5·Vitest, xlsx(CDN tarball) |
| `index.html` | HTML 진입점(ko, data-theme, 첫 페인트 전 테마 적용, 파비콘 PNG) |
| `.env` | **현재 dev DB(`lynchogququuwihhixrd`) 가리킴.** `.env.prod-backup`에 prod 값(Vite 미인식 파일명). 둘 다 커밋 금지 |
| `seed_stocks_2025.json` · `seed_financials_2025.json` | 종목·가격·재무 원천(build-data 입력) |
| `CLAUDE.md` · `README.md` | 개발 규칙·아키텍처 · 개요·실행·세팅(README는 장중/옵션/2트랙까지 반영됨) |
| `docs/` | DECISIONS · ROADMAP · GAME_RULES · DATA_GUIDE · SCREENS · OPERATIONS · MANUAL_ADMIN · MANUAL_CONTENT |

---

## 3. DB 현황

> 아래는 **개발 DB(0001~0049 전부 적용) 기준**. 프로덕션은 §0·§1-A대로 0032 상태(8지표·옵션·장중 경로 없음).

### 3.1 테이블

> `private.config`(key/value) — `admin_secret`, `game_pin`(공용 게임 PIN, 0030). REST 노출 경로 없음.

| 테이블 | 핵심 컬럼(의미) |
|---|---|
| `game_state` (단일 행 id=1) | `current_round`(0=시작전, total+1=종료), `total_rounds`, `round_year_map`, `default_seed`, `is_locked`, `round_ends_at`, **`round_start_at`**(진행률 기준점, 0043), `round_duration_seconds`(기본 600), `final_year`, `is_ended`, `active_dataset_id`, `join_mode`(`code`\|`open`) |
| `stocks` | `id`(PK), `name`(unique), `description`, `sector`, `listed_from_round`, `prices`(연도→연말가, 0/없음=거래정지), `display_order`, **`default_iv`**(옵션 자동상장 기본 변동성, nullable, 0042) |
| `stock_price_paths` (PK stock+year, 0043) | `prices numeric[252]`(일별 경로), **`source`**(`bridge`\|`engine`, 0045) |
| `financials` (PK stock+year) | 재무 **입력 잎 7개(억원)**: `current_assets`·`noncurrent_assets`·`current_liabilities`·`noncurrent_liabilities`·`revenue`·`operating_expense`·`nonoperating_expense`. 파생값은 저장 안 함(프론트 `deriveFinancials`). *0031에서 옛 5지표 교체* |
| `macro` (PK year) | `summary` + **표시 8지표** `kospi·sp500·nikkei·europe·rate·cpi·oil·gold`(0033~0034). 옛 `gdp·unemployment·fx`는 컬럼만 남음(표시 제외) |
| `datasets` | `id`(PK), `name`, `description`, `payload`(jsonb 콘텐츠 한 벌 — macro 8지표 포함), `created_at` |
| `round_configs` (PK round, 0038) | `macro`(jsonb 시뮬 입력 + `market_multiplier`), `seed`, `note`, `updated_at`. **RLS select 정책 없음**(스포일러 차단, admin RPC 전용) |
| `teams` | `id`(uuid), `code`(unique, 로그인 신원), `name`, `seed`, `cash`, `last_login_at`, `pin`(옛 팀별 PIN — 0030 이후 미사용) |
| `positions` (PK team+stock) | `quantity`(보유), `avg_price`(가중평균단가). 전량 매도 시 행 삭제 |
| `trades` | `side`(buy/sell), `price`, `quantity`, `round`, `realized_pnl`(매도만), `created_at` |
| `round_snapshots` (PK team+round) | `equity`(그 라운드 떠날 때 평가금액). 종료 스냅샷 round=total+1 |
| `hints` | `round`, `grade`(S~D), `headline`, `impact`(up/down/flat), `related_stock_ids[]` |
| `hint_grants` (PK hint+team) | 누가 어떤 힌트를 받았나 + `granted_at` |
| `options_contracts` (0041) | 종목·행사가·만기 라운드·타입(put)·σ·r·활성 여부. 자동 상장 행 포함(0042) |
| `user_options_positions` (0041) | 조별 옵션 보유(항상 롱 — side 컬럼 없음). 만기 시 `settle_options_round`가 정산 |
| `game_trade_logs` (0039) | `event_type`(view_stock/open_order_panel/submit_order/broadcast_seen/news_seen/hedge_executed), `stock_id`, `meta`, `created_at`. append-only, 프론트 미연결 |
| `savings_products` · `user_savings` (0040) | 고정금리 복리 예금 상품/가입. `team_equity`가 잔액 포함하도록 재정의. 프론트 미연결 |
| `signals` | `kind`, `payload`(jsonb), `created_at`. Realtime publication 등록 |
| `broadcasts` | `round`, `headline`, `created_at`. 전원 공개 |
| `private.config` | `key`(admin_secret·game_pin)/`value`. PostgREST 노출 경로 없음 |
| `public_teams` (뷰) | teams에서 `code` 제외 공개(id·name·seed 등) |

**삭제됨** — `news`(0001→0005, 힌트로 대체), `order_sheets`(0004→0016, 즉시 체결 확정), `content_packs`(0022→`datasets` 통합).

### 3.2 RPC (개발 DB, 최종 정의 기준)

**학생용 (anon 호출, 비밀 불필요)**
| 함수 | 요약 |
|---|---|
| `login_team(p_code)` | 참가 코드 검증 + `last_login_at` 기록 |
| `join_team(p_name, p_pin)` | 자율 입장(open). `p_pin`은 공용 게임 PIN과 대조. 새 닉네임=조 생성(R0만), 기존=재접속. 미발급이면 `no_game_pin` |
| `place_order(p_team_code, p_stock_id, p_side, p_quantity)` | **즉시 체결.** 타이머 안에서만(밖이면 `round_closed`). 체결가 = **`exec_price`**(장중 스텝, 0044) |
| `quote_option_premium(...)` / `place_option_order(...)` | 옵션(보호적 풋) 견적 / 매수. `expiry_round > current_round`만 허용 (0041) |
| `current_price(p_stock_id)` | 현재 라운드 연말가(없으면 `final_year` 폴백, 0=거래정지). `security definer`(0018) |
| `team_equity`/`team_cash(p_team_id)` | 평가금액(옵션·예금 포함) / 예수금 |
| `leaderboard()` | rank·equity·pnl·pnl_pct·prev_rank. 동률은 `created_at` 안정 정렬(0029) |
| `get_my_hints(p_team_code)` | 내 조 지급 힌트만 |
| `get_financials()` / `get_macro()` | 재무·시황. 현재 라운드 연도까지만(스포일러 차단) |

**관리자용 (`p_admin_secret` 필수)**
| 함수 | 설명 |
|---|---|
| `advance_round` | 연도 넘기기. 스냅샷 → 새 연말가 공개 → `distribute_round_hints`(라운드로빈) → `settle_options_round`(만기 옵션 정산) → 다음 라운드 옵션 자동 상장 |
| `start_round_timer(p_minutes)` / `adjust_round_timer(p_seconds)` | 거래 창 열기(+`round_start_at`) / 진행 중 ±조정 |
| `admin_end_game` / `reset_game` | 최종 스냅샷·`is_ended` / 초기화(조·콘텐츠 유지 + 게임 PIN 초기화) |
| `admin_update_game_config` | 게임 설정(시드·총 라운드·`p_join_mode` 등). 시작 전에만 |
| `admin_set_game_pin` | 공용 게임 PIN 발급/재발급(무작위 4자리 → `private.config`). 값 반환, 신호엔 미포함 |
| `admin_teams_status` | 조별 seed/cash/equity/pnl + 이번 라운드 거래 수 + 힌트 수 + `last_login_at` + **매매 통계 6키**(0046) + game_pin |
| `admin_create_team`/`admin_delete_team`/`admin_rename_team`/`admin_set_team_seed` | 조 CRUD·이름 수정 |
| `admin_upsert_stock`/`admin_delete_stock` | 종목 CRUD(업종·상장 라운드·연도별 가격·순서·default_iv) |
| `admin_upsert_macro`/`admin_list_macro` | 시황 편집/전체 조회(8지표) |
| `admin_upsert_financial`/`admin_list_financials`/`admin_delete_financial` | 재무 편집(입력 7개)/조회/비움 |
| `admin_apply_simulated_prices` (0035) | 주가 생성기 결과 `{stock_id:{year:price}}`를 한 트랜잭션으로 반영. 브리지 트리거는 `source='engine'`로 스킵 |
| `admin_apply_generated_content` (0047) | 검증된 재무 7입력 upsert + 지정 라운드 힌트 교체(생성기 자동 정합) |
| `admin_upsert_round_config` (0038) | 라운드별 시뮬 파라미터 저장(감사·재현). 프론트 미연결 |
| `admin_upsert_options_contract`/`admin_deactivate_options_contract` (0041) | 옵션 계약 관리 |
| `admin_compute_team_analytics` (0039) | 참가자 행동 집계(MBTI·배지). 프론트 미연결 |
| `admin_save_dataset`/`admin_list_datasets`/`admin_get_dataset`/`admin_load_dataset`/`admin_import_dataset`/`admin_delete_dataset` | 데이터셋 저장·목록·조회·불러오기(리셋)·가져오기·삭제 |
| `admin_list_hints`/`admin_upsert_hint`/`admin_delete_hint`/`admin_grant_hints`/`grant_hint`/`revoke_hint` | 힌트 풀·지급 관리 |
| `admin_send_broadcast`/`admin_delete_broadcast` | 속보 발송/회수 |
| `admin_login` | 비밀번호 검증만 |

**내부용 (anon에서 execute revoke)** — `emit_signal`, `distribute_round_hints`, `settle_options_round`, `public_year`,
`private.exec_price`·`private.round_step_idx`·`private.bridge_path`·`private.tick_*`(레거시)·`private.norm_cdf`,
`snapshot_content`·`restore_content`(데이터셋 왕복), `private.set_admin_secret`·`private.verify_admin`(fail-closed).

### 3.3 보안 상태

- **쓰기 정책이 하나도 없다.** 모든 쓰기는 `security definer` RPC로만.
- **읽기 정책** — `game_state`·`stocks`·`stock_price_paths`·`positions`·`trades`·`round_snapshots`·`signals`·`broadcasts`는 공개.
  **`teams`·`hints`·`hint_grants`·`round_configs`·`savings_*`·`game_trade_logs`는 select 정책 없음** — RPC로만.
  `teams`는 `public_teams` 뷰(code 제외)만.
- **`financials`·`macro`** — 표는 열려 있어도 학생은 RPC로 현재 연도까지만 받는다. `datasets`·`round_configs`는 관리자 RPC로만.
- **관리자 비밀** — `private.config`(REST 경로 없음). `set_admin_secret` 부트스트랩, `verify_admin` fail-closed.
  **현재 개발 기본값(약함) — 실전 전 강화 필요.**
- **가격 조작 방어** — 체결가(`exec_price`)·옵션 스팟은 서버가 스스로 계산한다(클라이언트가 가격을 파라미터로 못 보냄).

---

## 4. 검증 현황

### 자동 테스트 — **Vitest 225개 / 20파일 전부 통과** (`npm test`, 2026-09-06 재확인), `npm run build` 통과

- `account`·`payoff`·`chart`·`draw`·`data`·`distribute`·`metrics`·`gameData` — 순수 로직·정합성(호재/악재↔등락, 항등식, 자본잠식).
- `components/*` — Chart·StockList·QtyStepper 렌더·상호작용 회귀.
- `admin/*` — 주가 생성기 엔진(`priceSim`)·미리보기(`AdminSimulator`·`FloatingRoundDock`)·자동 정합(`simContent`)·Gemini 경로(`gemini`·`hintService`).

### 수동 / 실 DB / 브라우저 검증 이력

- `verify_game.mjs --yes` — 5라운드 풀 시뮬(신규상장 거부→매수·상장폐지 평가액 0·R2~R5 자동 힌트·최종 정산) 통과.
- `verify-intraday-step-parity.mjs` / `verify-auto-listing.mjs` — 장중 스텝 동일성 / 옵션 자동 상장·정산(개발 DB).
- 브라우저(playwright-core + 시스템 Chrome) — 관리자 재구성·데이터셋 전환·학생 상장폐지 경고·타이머 색·30초 토스트·순위 변동 형식 실측.
- Keep-Alive 워크플로 수동 실행 성공 확인.
- 원격 플레이테스트 — 친구 5명, 로그인·매매·관리자 조작 기능 점검(부하 실측 아님).

### 아직 커버 안 된 영역

- **프로덕션 DB에서의 0033~0049** — 개발 DB에서만 검증. prod push 후 재검증 필요.
- **실기기 태블릿**(터치·그리기·회전) — 헤드리스만.
- **동시 다접속 부하** — 기능만 확인.
- **옵션·장중 시세의 교실 실사용** — 엔진·UI는 돌지만 학생 대상 플레이테스트는 현물만.
- **콘텐츠 정확성** — 테스트는 내부 정합(태그↔등락)만. 현실 사실(실제 재무 수치)은 초안.
- **0038~0040(round_configs·텔레메트리·예금)** — DB만 있고 UI 없음 → 사실상 미검증.

---

## 5. 미커밋 변경 / git ↔ DB 정합

- **작업 트리** — 깨끗함. 브랜치 `feat/round-report-and-admin-stats`(main보다 14 커밋 앞, 0 뒤 — 사실상 main과 동일 내용).
- **개발 DB(`lynchogququuwihhixrd`)** — `supabase migration list --linked` 확인: 0001~0049 전부 적용, pending 없음. git과 일치.
- **프로덕션 DB(`zhwidhvoxcoljffvqhol`)** — 0001~0032. 0033 이후는 전부 개발 DB 대상이었고 prod 대상 `db push`는 없었다.
  ⚠ **Vercel 라이브 프론트는 0033+ 기능(8지표·옵션·장중·생성기)을 호출하는데 prod DB엔 그 RPC/컬럼이 없다** —
  현재 프로덕션에서 해당 기능은 오류가 나거나 폴백된다(§6-2가 우선 과제인 이유).
- **로컬 env** — `.env` = dev DB. prod 값은 `.env.prod-backup`(Vite 미인식). prod 빌드를 로컬에서 내려면 교체 필요.
- **관리자 비밀** — DB `private.config`와 `.env`가 개발 기본값으로 일치(약함, 강화 대기).
- **배포** — Vercel(main 자동), Keep-Alive Actions 가동. 도메인 <https://cufic-wts.vercel.app>.

---

## 6. 발견된 불일치 / 정리 필요

> "문서·설정과 실제가 어긋나는" 지점. 기능은 대체로 동작하나 정리가 필요하다.

1. ~~**마이그레이션 32개·테스트 79개·시황 6지표로 적힌 문서 드리프트**~~ → **이 갱신(2026-09-06)에서 해소.**
   STATUS 전면 재작성, CLAUDE.md의 "프로젝트는 하나다"·시황 6지표 표기 수정, ROADMAP §알려진 한계 갱신.
2. **프로덕션 DB가 0032에 멈춰 있다 (최우선).** 개발 DB는 0049. 대회 전:
   `.env`를 prod로 교체 → `npx supabase db push`(0033~0049) → `node scripts/gen-seed.mjs` 후 시드 재적용 →
   콘텐츠 데이터셋 재저장(8지표) → `reset_game` → 실기기 리허설. → [OPERATIONS](OPERATIONS.md)에 절차로 남길 것.
3. **마이그레이션 0038~0042 헤더 주석의 `dqvcagrbkvhnetqydgnk`** — 옛/폐기된 dev ref. 실제 개발 DB는 `lynchogququuwihhixrd`.
   또 "dev DB 전용 적용 예정" 문구도 이미 적용됐으니 현재형이 아니다. 주석 정리 대상(무해).
4. **0038~0040(round_configs·텔레메트리·예금)은 스키마만 있고 호출하는 화면이 없다.** 대회에서 쓸 거면 UI가 필요하고,
   안 쓸 거면 프로덕션 push 목록에서 빼는 게 깔끔하다(팀 결정 대기).
5. **`.env` 하나로 dev/prod를 겸한다.** `npm run dev`도 `vite build`도 같은 파일을 읽어 지금은 둘 다 dev DB로 간다.
   Vite 규약대로 `.env`(공통) + prod 전용 override 파일로 나누면 실수 여지가 준다.
6. **`sheet_saved` 신호는 레거시** — 주문서 경로 삭제 후 남은 무해한 신호. 구독부는 무시. 다음 스키마 정리 때 제거 후보.
7. **README "174개 테스트"** — 실제 225개. README 나머지(장중·옵션·2트랙 설명)는 최신. 숫자만 경미하게 낡음.
