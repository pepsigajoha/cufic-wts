# 현황 스냅샷 (STATUS)

> **갱신: 2026-08-20** · 게임 모델 **v3**(즉시 체결 + 라운드 타이머) + **재무제표 v4**(입력 7 + 파생) + **콘텐츠 전면 DB 이관(B)** + **데이터셋 엑셀 왕복** + **자율 입장 + 공용 게임 PIN** + **배포** 기준.
> 이 문서는 "지금 이 순간 무엇이 있고 무엇이 없나"의 완전한 스냅샷이다. 외부 검수·내년 인수인계용.
> 판단의 *이유*는 [DECISIONS.md](DECISIONS.md), 게임 *규칙*은 [GAME_RULES.md](GAME_RULES.md),
> *화면*은 [SCREENS.md](SCREENS.md), *데이터 교체*는 [DATA_GUIDE.md](DATA_GUIDE.md)·[MANUAL_CONTENT.md](MANUAL_CONTENT.md),
> *대회 운영*은 [OPERATIONS.md](OPERATIONS.md), 강사 매뉴얼은 [MANUAL_ADMIN.md](MANUAL_ADMIN.md)를 본다.

한 줄 요약: **전 과정(로그인→매매→라운드 전환→자동 힌트→최종 정산)이 실측으로 돌고, Vercel에 배포돼
원격 플레이테스트까지 마쳤다. 콘텐츠(재무·시황·힌트·주가)는 전부 DB에 있고, 관리자 화면에서 **엑셀 양식으로
통째로** 또는 각 탭에서 직접 만들어 데이터셋 단위로 저장·전환한다. 학생은 참가 코드 또는 **닉네임+PIN(자율 입장)**으로
들어온다. 남은 건 실기기 검증·대회 전 초기화 리허설·(선택) 인과 엔진이다.**

---

## 1. 전체 진행률

### ✅ 완료 (동작 확인됨)

**백엔드 (Supabase, 프로젝트 `cufic_wts` / `zhwidhvoxcoljffvqhol`, 서울)**
- 마이그레이션 **32개**(0001~0032) 전부 remote 적용. 스키마 재현 가능(대시보드 수동 편집 없음).
- **즉시 체결 + 라운드 타이머** — `place_order`가 그 자리에서 체결, `now() < round_ends_at`을 서버가 강제.
- **게임 루프** — `advance_round`(연도 넘기기) → `start_round_timer`(거래 창 열기) → 자동 마감. 진행 중 `adjust_round_timer`로 ±조정(0019).
- **자동 힌트 차등 지급(라운드로빈, 0025)** — R2부터 `distribute_round_hints`가 힌트 풀을 등급순 정렬 후
  **꼴찌부터 라운드로빈**으로 전부 배분(하위권일수록 좋은 힌트 + 더 많이). 수동 지급 보조.
- **콘텐츠 전면 DB화(B)** — 재무제표(`financials`)·거시 시황(`macro`)이 DB에 있고 관리자 화면에서 직접 편집.
  학생용 `get_financials`/`get_macro`는 **현재 라운드 연도까지만** 반환(미래 스포일러 차단).
- **데이터셋(시나리오)** — `datasets` 테이블 + 저장·불러오기·가져오기/내보내기. `game_state.active_dataset_id`가
  "지금 사용 중인 한 벌"을 가리킨다. 불러오기는 게임 리셋을 동반(조 유지), 진행 중엔 잠금.
- **데이터셋 엑셀 왕복** — 공식 양식(.xlsx) 다운로드/업로드로 콘텐츠 한 벌을 통째로 편집. 업로드는 3단계 리포트(오류·경고·정보)
  후 **항상 새 데이터셋 생성**(덮어쓰기 아님). JSON 가져오기/내보내기도 지원. `src/admin/datasetXlsx.js`(SheetJS 동적 로드).
- **자율 입장(open, 0028) + 공용 게임 PIN(0030)** — `game_state.join_mode`(`code`|`open`)로 전환. open이면 학생이
  **닉네임 + 공용 게임 PIN**으로 입장/재접속(`join_team`, Kahoot식). 공용 PIN은 강사가 시작 전 무작위 4자리 발급(`admin_set_game_pin`),
  `private.config('game_pin')`에 저장(anon이 못 읽음). 기존 닉네임은 재접속, 새 조는 시작 전(R0)만. 시작 전에만 방식 변경 가능.
- **최종 정산** — `admin_end_game`이 `final_year`(2025) 가격을 공개하고 스냅샷. 떠나는 라운드·최종 두 지점 모두 기록(0017).
- **공통 속보** — `broadcasts` 전원 공개, 실시간 신호.
- **조 접속 추적(0027)** — `login_team`/`join_team` 성공 시 `teams.last_login_at` 기록, `admin_teams_status`가 함께 반환(최근 10분 = 접속).
- **리더보드 동률 결정론(0029)** — 평가금액 동률이면 조 생성순(`created_at`)으로 안정 정렬.
- **실시간** — `signals` 테이블 + Realtime. 신호 수신 → 각자 RPC 재조회.
- **관리자 보호** — 관리자 RPC 전부 `p_admin_secret` + `private.verify_admin`. 비밀은 `private` 스키마, fail-closed.

**배포 / 운영**
- **Vercel 배포** — https://cufic-wts.vercel.app (GitHub `ms4317/cufic-wts`, public, main push 시 자동 재배포).
- **원격 플레이테스트 완료** — 친구 5명 각자 접속, 로그인·매매·관리자 조작 기능 점검.
- **Keep-Alive 가동** — `.github/workflows/keepalive.yml`이 매일(UTC 04:17) REST 핑으로 무료 플랜
  일시정지를 막는다. 저장소 시크릿(`SUPABASE_URL`·`SUPABASE_ANON_KEY`) 설정 완료, 수동 실행 **성공 확인**.

**학생 화면**
- **입장 2방식** — 참가 코드(서버 검증) 또는 **닉네임 + 공용 게임 PIN(자율 입장)**. 자율 입장은 한 화면(닉네임+PIN): 새 닉네임=새 조, 기존 닉네임=재접속. 새로고침 자동 재로그인 · 로딩/실패/오프라인 처리.
- 즉시 매수·매도(비율 버튼·수량 스테퍼) · 거래 타이머 카운트다운 · 타이머 밖 버튼 잠금.
- **거래 타이머(`RoundTimer.jsx`: `TimerPill`)** — 헤더 필(라벨+시간+아래 얇은 진행바, 학생·관리자 공통). 여유=골드 / 60초↓=경고(`--warn` 주황) / 30초↓=긴급(빨강+점 깜빡임+테두리 발광) + 30초 토스트(1회). 두 테마. 진행바 기준값=`round_duration_seconds`.
- **상장폐지 보유 경고** — 주문 패널 보유행·MY 보유표·라운드 요약에 "⚠ 상장폐지 · 전액 손실" 표시.
- 힌트(헤더 버튼 → 팝업, 등급 S~D, 내 조 것만, 도착 토스트).
- **시황판(거시경제)** — 헤더 📈 시황 → 연도별 금리·GDP·실업률·환율·물가·유가 표(현재 연도까지). 배경 정보(인과 미적용).
- 차트(결정론적 캔들·추세선 그리기) · 재무제표(연도 스포일러 차단) · MY 계좌(보유/체결/**수익률 차트**).
- 조별 순위 팝업 · **라운드 전환 요약(평가금액 변동 + 순위 "5위→3위" 변동 + 상장폐지 경고)** · 대회 종료 모달(전체 순위·순위 변동) · 속보 팝업.
- **로고 교체** — CUFIC 심볼 PNG(헤더 40px·로그인·파비콘), 다크 테마용 리컬러 변형 자동 스왑. 종목 코드(S01) 숨김.
- 시작 전 헤더 표기 "시작 전 · 대기 중"(학생·관리자 통일).
- 다크/라이트 · 태블릿 대응(44px 터치·세로 회전 안내).

**관리자 화면 (`/?admin=1`) — 탭 2그룹 재구성**
- **[대회 운영]** 진행 · 리더보드 / **[게임 준비]** 데이터셋 · 종목·가격 · 재무·시황 · 힌트 · 조 관리. 탭마다 한 줄 도움말.
- **진행** — 시작 전 **대회 준비 시작 카드**(①데이터셋 ②입장 PIN 발급 ③입장 확인 ④대회 시작, PIN 미발급 가드) → 시작 후 다음 할 일·연도 넘기기·타이머 시작(**설정값**·±1분)·대회 종료·속보·거래 현황 · (대회 준비) 게임 설정·데이터 점검·리셋.
- **데이터셋** — 지금 편집 중 + **미저장 변경(●) 배지** · [💾 저장](덮어쓰기 확인)/[+ 새 데이터셋]. **받기**: [빈 양식 .xlsx]·[양식 다운로드(예시 채움 .xlsx)]·[데이터 다운로드 .json]. **올리기**: [엑셀 업로드](3단계 리포트→새 데이터셋)·[JSON 가져오기]. 목록 행마다 [편집]/[엑셀]/[JSON]/[삭제].
- **종목·가격** — 종목 CRUD + 연도별 인라인 편집(0=거래정지·소급 안 됨 경고).
- **재무·시황** — 연도별 시황 6지표 + 종목별 재무 **입력 7개(잎)만 입력, 자산·자본·이익·부채비율·ROE는 자동 계산**(저장/비움). 지표 정의는 `src/metrics.js` 단일 소스(`FIN_INPUTS`·`FIN_DERIVED`·`deriveFinancials`).
- **힌트** — 풀 CRUD · 조별 수동 지급/취소 · 자동 배분 미리보기(호재/악재↔등락 불일치 경고).
- **조 관리** — code: 코드로 조 추가/삭제. open: **게임 입장 PIN 카드**([발급]/[재발급]) + 실시간 입장 목록(코드·조추가 숨김) + **이름 인라인 수정**. 공통: 시드[시작 전만]·예수금/평가/수익률/거래/힌트 + **접속 열**(최근 10분).
- **리더보드** — 순위·순위 변동 ▲▼·단독 1위 골드·프로젝터용 큰 글씨 · **[대회 결과 내보내기 CSV]**(순위·라운드별 스냅샷·거래 로그 3구획, UTF-8 BOM).

**데이터 / 품질**
- 2025 기반 초안 데이터(**18종목 · 5라운드 2020~2024 · 최종 2025**). `src/data.js`는 이제 "초기 템플릿"(데이터셋 시딩용 생성물).
- **Vitest 79개 / 6파일 전부 통과**(재무 `deriveFinancials` 자동계산·자본잠식 포함). `verify_game.mjs`로 5라운드 실 DB 시뮬레이션 통과.
- 콘텐츠 정합성 점검(`dataCheck.js`)이 관리자 [데이터 점검]으로 노출(호재/악재↔등락·힌트 누락·가격 공백).

### 🟡 진행 중 / 확정 대기

- **콘텐츠 검토** — 재무 수치·힌트 문구·종목 소개는 **팀 검토 전 초안**. 구조는 확정, 값은 미확정.
- **인과 엔진(거시지표→주가 자동 반영)** — 미적용. 팀 논의 대기. 현재 시황판은 배경 정보일 뿐.
- **관리자 비밀번호 강화** — 현재 개발 기본값(약함). 실전용 강한 값으로 교체 대기(값은 사용자 지정 필요).
- **순위 상시 노출 여부** — 팀 결정 대기(현재는 팝업 + 리더보드 탭).

### ⬜ 미착수

- **실기기 태블릿 테스트** — 실제 터치·그리기·회전(지금은 헤드리스 브라우저 검증만).
- **대회 전 초기화 리허설** — `reset_game` + 검증용/플레이테스트 조 정리 실측(→ OPERATIONS).
- **봉 주기 실데이터화** — 일/주/월/년이 전부 같은 1년 구간(알려진 껍데기).
- **파일 정리** — `index.css` 분리(리팩터, 후순위).

---

## 2. 파일 지도

> 전 파일 1줄 설명. 자동 생성 파일(`src/data.js`·`supabase/seed.sql`)은 직접 편집 금지.

### `src/` — 진입점·유틸
| 파일 | 역할 |
|---|---|
| `main.jsx` | React 진입점. `App`을 `#root`에 마운트, `index.css`·`admin.css` 로드 |
| `App.jsx` | 최상위. `?admin`이면 관리자, 아니면 학생 화면. 학생 상태·데이터 로드·실시간 신호·모달 오케스트레이션 |
| `account.js` | 계좌 파생 순수함수. `deriveAccount`(평가금액=예수금+보유평가, 총손익), `positionPnl` |
| `chart.js` | 종목별 결정론적 캔들 생성(`candleSeries`), 봉주기(`TIMEFRAMES`), 이동평균(`movingAverage`) |
| `draw.js` | 차트 낙서 기하 순수함수. 점-선분 거리(`distToSegment`), 지우개 판정(`strokeHit`) |
| `format.js` | 숫자·부호·방향 포맷(`num`,`signed`,`pct`,`dirOf`,`arrowOf`,`eok`,`nowTime`). 한국 증시 색 관례 |
| `gameData.js` | 서버 상태→화면 가공. `yearOf`,`buildStocks`,`loadAll`,`refetchMine`,`subscribeSignals`(재무·시황·데이터셋 신호 포함) |
| `supabase.js` | Supabase 클라이언트 + `rpc`/`select` 래퍼(`{ok,error}`) + 거부 사유→한국어(`errorText`) |
| `auth.js` | 입장(`login_team`=코드 / `join_team`=자율 입장 닉네임·PIN), localStorage 저장, 자동 재로그인(`restore`), `logout` |
| `theme.js` | 다크/라이트 테마 훅(`useTheme`). `<html data-theme>` + localStorage |
| `useSize.js` | `ResizeObserver`로 엘리먼트 실측 크기 추적(SVG viewBox 정합) |
| `actions.js` | 상태 변경 동작. 학생 `makeActions`(placeOrder), 관리자 `makeAdminActions`(매 호출 `p_admin_secret`. 콘텐츠·데이터셋 포함) |
| `dataCheck.js` | 콘텐츠 정합성 검사(`checkContent`·`hintMismatches`). 관리자 [데이터 점검]이 사용 |
| `distribute.js` | 힌트 라운드로빈 배분 로직(`sortPool`·`rankWorstFirst`·`assignRoundRobin`·`distribute`). 미리보기가 사용 |
| `metrics.js` | **재무·시황 지표 정의 단일 소스**(`FIN_INPUTS` 7 입력 + `FIN_DERIVED` 파생 + `deriveFinancials()` · `MACRO_METRICS` 6, key/db/xlsx/label/unit). 모달·편집·엑셀 파서가 참조. `data.js`가 재수출 |
| `data.js` | **자동 생성**. 데이터셋 초기 템플릿 + 재무제표 모달·정합성 테스트의 공통 원천(종목·가격·힌트·재무·시황·상수) |
| `index.css` | 학생 화면 스타일 + 테마 CSS 변수(다크/라이트). 색 하드코딩 금지 |
| `admin.css` | 관리자 화면·보유목록·부팅/로딩/에러 스타일 |

### `src/` — 테스트 (6파일 / 79개)
| 파일 | 커버 |
|---|---|
| `account.test.js` | `deriveAccount`·`positionPnl`(평가금액 파생, 거래정지 −100%) |
| `chart.test.js` | `candleSeries`·`movingAverage`(차트 방향 = 실제 등락, 회귀) |
| `draw.test.js` | `distToSegment`·`strokeHit`(지우개 선분 판정, 회귀) |
| `data.test.js` | 데이터 정합성(종목·힌트·재무·라운드 전수, **호재/악재 태그↔다음 해 등락**) |
| `distribute.test.js` | 힌트 라운드로빈(꼴찌부터 배분·하위권 우대·전량 소진) |
| `components/QtyStepper.test.jsx` | 수량 입력(클램프·Esc·전체선택 타이밍, 회귀) |

### `src/components/` — 학생 화면
| 파일 | 역할 |
|---|---|
| `Modal.jsx` | 공통 모달(딤·X·ESC·포커스 트랩·배경 스크롤 잠금, `wide` 옵션) |
| `Toast.jsx` | 토스트 훅(`useToasts`)·렌더러(자동 소멸, 클릭형 지원) |
| `ThemeToggle.jsx` | 다크/라이트 토글 버튼(해·달 SVG) |
| `RotateNotice.jsx` | 세로 화면(1023px↓) CSS 회전 안내 오버레이(JS 감지 없음) |
| `DrawLayer.jsx` | 차트 위 그리기 SVG(펜·추세선·지우개, 좌표 0~1 정규화) |
| `QtyStepper.jsx` | 주문 수량 입력(−/+·직접입력·방향키·클램프)과 비율 버튼(`QtyRatios`) |
| `Login.jsx` | 참가 코드 입장 화면(로고 마크) |
| `Header.jsx` | 상단 헤더(로고 40px·팀·라운드/"시작 전 · 대기 중"·거래 타이머[임박 색]·순위·내 힌트·📈 시황·속보 종·계좌·테마·로그아웃) |
| `StockList.jsx` | 좌측 종목 목록(종목명·정렬·현재가·등락률·거래정지·상장예정 숨김·보유 표시. 종목 코드 미표시)과 MY 열기 |
| `Chart.jsx` | 가운데 차트 패널(종목명·시장·재무 버튼·그리기·봉주기·캔들/MA/현재가선) |
| `OrderSheet.jsx` | 우측 주문 패널(즉시 체결 매수/매도·비율·예상금액·거래 안내·보유종목·상장폐지 경고) |
| `FinancialModal.jsx` | 재무제표 모달(소개 + **연도 탭** → 재무상태표 T자형 + 손익계산서 단계차감 + 파생 칩[부채비율·ROE, 자본잠식 표시] + 용어 접기. 현재 라운드 초과 연도 스포일러 차단) |
| `MarketModal.jsx` | 시황판 모달(연도별 거시 6지표·탭하면 지표 설명·현재 연도까지 공개) |
| `HintModal.jsx` | 내 힌트 팝업(등급·라운드·헤드라인·관련 종목. 호재/악재는 **의도적 미표시**) |
| `BroadcastModal.jsx` | 속보(공통) 목록 팝업, 최신순 |
| `EmergencyBroadcast.jsx` | 새 속보 도착 시 뜨는 재난문자식 강조 팝업 |
| `MyModal.jsx` | MY 계좌(요약 바 + 보유종목/체결내역/**수익률 차트** 탭. 상장폐지 배지) |
| `RoundModal.jsx` | 라운드 전환 요약(새 연도·평가금액 변동·순위 "N위→M위" 변동·상장폐지 경고·보유 최고/최저 등락) |
| `FinalModal.jsx` | 대회 종료 모달(내 최종 순위·자산·수익률 + 전체 조 순위표·순위 변동) |
| `RankingModal.jsx` | 전체 조 순위 팝업(내 조 강조) |

### `src/admin/` — 관리자 셸 + 7탭
| 파일 | 역할 |
|---|---|
| `Admin.jsx` | 관리자 셸(비밀번호 로그인·sessionStorage·실시간 구독·탭 2그룹 네비·탭 도움말) |
| `AdminProgress.jsx` | 진행 탭(시작 전 대회 준비 카드[데이터셋·PIN·입장확인·시작]·다음 할 일·연도 넘기기·타이머 시작[설정값 durMin]·±1분·대회 종료·리셋·속보·거래 현황·게임 설정·데이터 점검) |
| `AdminBoard.jsx` | 리더보드 탭(순위·순위 변동·단독 1위 골드·큰 글씨 + **대회 결과 CSV 내보내기**) |
| `AdminDatasets.jsx` | 데이터셋 탭(미저장 배지·저장/새로·엑셀·JSON 받기/올리기·편집 전환·삭제·검사 리포트 모달) |
| `datasetXlsx.js` | 엑셀 왕복(`parseWorkbook`·`buildWorkbook`·`buildBlankWorkbook`). % 등락률 파싱, 3단계 리포트. SheetJS 동적 로드 |
| `AdminStocks.jsx` | 종목·가격 탭(종목 CRUD·연도별 인라인 편집·0=거래정지·소급 안 됨 경고) |
| `AdminContent.jsx` | 재무·시황 탭(연도별 시황 6지표 + 종목별 재무 **입력 7개**[잎]만 입력, 자본·이익·비율은 옆에 실시간 계산. 저장 시 학생 화면 즉시 반영) |
| `AdminHints.jsx` | 힌트 탭(풀 CRUD·조별 수동 지급/취소·자동 배분 미리보기·힌트 편집기) |
| `AdminTeams.jsx` | 조 관리 탭. open이면 게임 PIN 카드·실시간 목록·이름 인라인 수정, code면 코드로 조 추가. 시드[시작 전만]·현황·**접속 열**[최근 10분] |

### `scripts/` · `.github/`
| 파일 | 역할 |
|---|---|
| `build-data.mjs` | JSON(주가·재무) + 내장 소개·힌트 → `src/data.js` 생성 |
| `gen-seed.mjs` | `src/data.js` → `supabase/seed.sql` 생성(재적용 가능 DELETE+INSERT) |
| `verify_game.mjs` | Management API로 실 DB 5라운드 풀 시뮬레이션(`--yes` 필수, `reset_game` 하므로 대회 중 금지) |
| `.github/workflows/keepalive.yml` | 매일 Supabase REST 핑(무료 플랜 일시정지 방지). 시크릿 2개 필요 |

### `supabase/`
| 파일 | 역할 |
|---|---|
| `migrations/*.sql` | 스키마·RPC 이력 **32개**(0001~0032, 아래 §3) |
| `seed.sql` | **자동 생성**. game_state·stocks(18)·hints·검증용 조 재삽입 |
| `config.toml` | Supabase CLI 설정(project_id, 포트, seed 지정) |

### 루트 / 문서
| 파일 | 역할 |
|---|---|
| `package.json` | npm(dev/build/test), React 18·@supabase/supabase-js, Vite 5·Vitest |
| `index.html` | HTML 진입점(ko, data-theme, 첫 페인트 전 테마 적용, 파비콘 PNG) |
| `src/assets/cufic-logo*.png` · `public/favicon.png` | 로고 자산(라이트·다크 변형·파비콘) |
| `.env.example` | 환경변수 템플릿(`.env`는 커밋 금지, 실제 비밀) |
| `seed_stocks_2025.json` · `seed_financials_2025.json` | 종목·가격·재무 원천(build-data 입력) |
| `CLAUDE.md` · `README.md` | 개발 규칙·아키텍처 · 개요·실행·세팅 |
| `docs/` | DECISIONS · ROADMAP · GAME_RULES · DATA_GUIDE · SCREENS · OPERATIONS · MANUAL_ADMIN · MANUAL_CONTENT |

---

## 3. DB 현황

### 3.1 테이블 (32개 마이그레이션 적용 후 현재 — public 13개 + private.config + public_teams 뷰)

> `private.config`(key/value) — `admin_secret`, **`game_pin`**(공용 게임 PIN, 0030). REST 노출 경로 없음(anon이 못 읽음).

| 테이블 | 핵심 컬럼(의미) |
|---|---|
| `game_state` (단일 행 id=1) | `current_round`(0=시작전, total+1=종료), `total_rounds`(5), `round_year_map`(라운드→연도), `default_seed`, `is_locked`, `round_ends_at`(거래 마감 시각), `round_duration_seconds`(기본 600, 대기 안내·데이터셋용), `final_year`(2025), `is_ended`, **`active_dataset_id`**(지금 쓰는 데이터셋), **`join_mode`**(`code`\|`open`, 기본 code) |
| `stocks` | `id`(PK), `name`(unique), `description`, `sector`, `listed_from_round`(신규상장), `prices`(연도→가격, 0/없음=거래정지), `display_order` |
| `financials` (PK stock+year) | 연도별 재무 **입력 잎 7개(억원)**: `current_assets`·`noncurrent_assets`·`current_liabilities`·`noncurrent_liabilities`·`revenue`·`operating_expense`·`nonoperating_expense`. 자산·부채·자본·영업이익·당기순이익·부채비율·ROE는 저장 안 함(프론트 `deriveFinancials` 계산). *0031에서 옛 5지표 교체* |
| `macro` (PK year) | 연도별 거시. `summary`(한 줄)·`rate`·`gdp`·`unemployment`·`fx`·`cpi`·`oil` |
| `datasets` | `id`(PK), `name`, `description`, `payload`(jsonb 콘텐츠 한 벌), `created_at` |
| `teams` | `id`(uuid), `code`(unique, 로그인 신원), `name`, `seed`, `cash`, **`last_login_at`**(접속 추적), `pin`(옛 팀별 PIN — 0030 이후 미사용) |
| `positions` (PK team+stock) | `quantity`(보유), `avg_price`(가중평균단가). 전량 매도 시 행 삭제 |
| `trades` | `side`(buy/sell), `price`, `quantity`, `round`, `realized_pnl`(매도만), `created_at` |
| `round_snapshots` (PK team+round) | `equity`(그 라운드 떠날 때 평가금액). 종료 스냅샷 round=total+1 |
| `hints` | `round`, `grade`(S~D), `headline`, `impact`(up/down/flat), `related_stock_ids[]` |
| `hint_grants` (PK hint+team) | 누가 어떤 힌트를 받았나 + `granted_at` |
| `signals` | `kind`, `payload`(jsonb), `created_at`. Realtime publication 등록(콘텐츠·데이터셋 변경 신호 포함) |
| `broadcasts` | `round`, `headline`, `created_at`. 전원 공개 |
| `private.config` | `key`(admin_secret)/`value`. PostgREST 노출 경로 없음 |
| `public_teams` (뷰) | teams에서 `code` 제외 공개(id·name·seed 등) |

**삭제됨** — `news`(0001→0005, 힌트로 대체), `order_sheets`(0004→0016, 즉시 체결 확정), `content_packs`(0022 도입→`datasets`로 통합).

### 3.2 RPC (최종 정의 기준)

**학생용 (anon 호출, 비밀 불필요)**
| 함수 | 요약 |
|---|---|
| `login_team(p_code)` | 참가 코드 검증 + `last_login_at` 기록. 목록은 안 줌 |
| `join_team(p_name, p_pin)` | **자율 입장(open 모드).** `p_pin`은 **공용 게임 PIN**(private.config)과 대조. 새 닉네임=조 생성(R0만), 기존 닉네임=재접속. `last_login_at` 기록. 미발급이면 `no_game_pin` |
| `place_order(p_team_code, p_stock_id, p_side, p_quantity)` | **즉시 체결.** 타이머 안에서만(밖이면 `round_closed`), 예수금·보유 검증 |
| `current_price(p_stock_id)` | 현재 라운드 가격(없으면 `final_year` 폴백, 0=거래정지). `security definer`(0018 복원) |
| `team_equity`/`team_cash(p_team_id)` | 평가금액 / 예수금 |
| `leaderboard()` | rank·equity·pnl·pnl_pct·**prev_rank**(직전 스냅샷 대비 등락). 동률은 `created_at`으로 안정 정렬(0029) |
| `get_my_hints(p_team_code)` | 내 조 지급 힌트만 |
| `get_financials()` / `get_macro()` | 재무·시황. **현재 라운드 연도까지만** 반환(스포일러 차단) |

**관리자용 (`p_admin_secret` 필수 → `verify_admin` 실패 시 `unauthorized`)**
| 함수 | 설명 |
|---|---|
| `advance_round(secret)` | 연도 넘기기. 스냅샷 → 새 가격 공개 → `distribute_round_hints` 자동 배분(라운드로빈) |
| `start_round_timer(secret, p_minutes)` / `adjust_round_timer(secret, p_seconds)` | 거래 창 열기 / 진행 중 ±조정. UI는 `round_duration_seconds`(설정값 durMin)를 전송 |
| `admin_end_game(secret)` | 대회 종료. 최종(2025) 스냅샷, `is_ended=true` |
| `reset_game(secret)` | snapshots/trades/positions/hint_grants/broadcasts 삭제, cash=seed, round=0(조·콘텐츠 유지) + **공용 게임 PIN 초기화**(0032, 리셋=새 판) |
| `admin_update_game_config(secret, ...)` | 게임 설정(시드·총 라운드·**`p_join_mode`** 등). 시작 전에만 변경 |
| `admin_set_game_pin(secret)` | **공용 게임 PIN 발급/재발급**(무작위 4자리 → `private.config`). 값을 돌려줌(강사가 읽어 전달). 신호엔 값 미포함 |
| `admin_teams_status(secret)` | 조별 seed/cash/equity/pnl + 이번 라운드 거래 수 + 힌트 수 + **last_login_at** + **game_pin**(공용) |
| `admin_create_team`/`admin_delete_team`/`admin_rename_team`/`admin_set_team_seed` | 조 CRUD·이름 수정(rename는 2~12자·중복 불가). 시드 변경은 `current_round>0`이면 거부 |
| `admin_upsert_stock`/`admin_delete_stock` | 종목 CRUD(코드·이름·소개·**업종·상장 라운드**·연도별 가격·순서. 0023에서 파라미터 확장) |
| `admin_upsert_macro`/`admin_list_macro` | 시황 편집/전체 조회 |
| `admin_upsert_financial`/`admin_list_financials`/`admin_delete_financial` | 재무 편집(**입력 7개** 파라미터, 0031에서 시그니처 교체)/조회/비움 |
| `admin_save_dataset`/`admin_list_datasets`/`admin_get_dataset`/`admin_load_dataset`/`admin_import_dataset`/`admin_delete_dataset` | 데이터셋 저장·목록·조회·불러오기(리셋)·가져오기·삭제 |
| `admin_list_hints`/`admin_upsert_hint`/`admin_delete_hint`/`admin_grant_hints`/`grant_hint`/`revoke_hint` | 힌트 풀·지급 관리 |
| `admin_send_broadcast`/`admin_delete_broadcast` | 속보 발송/회수 |
| `admin_login(secret)` | 비밀번호 검증만 |

**내부용 (anon에서 execute revoke)** — `emit_signal`, `distribute_round_hints`(라운드로빈, `advance_round`가 호출), `public_year`(스포일러 기준 연도), `private.set_admin_secret`, `private.verify_admin`(fail-closed).

### 3.3 보안 상태

- **쓰기 정책이 하나도 없다.** 모든 쓰기는 `security definer` RPC로만(클라이언트가 `teams.cash`를 직접 못 고침).
- **읽기 정책** — `game_state`·`stocks`·`positions`·`trades`·`round_snapshots`·`signals`·`broadcasts`는 공개.
  **`teams`·`hints`·`hint_grants`는 읽기 정책 없음** — RPC로만. `teams`는 `public_teams` 뷰(code 제외)만 공개.
  - **`financials`·`macro`** — 표는 열려 있어도 학생은 RPC(`get_financials`/`get_macro`)를 통해 **현재 연도까지만** 받는다(미래 스포일러 차단). `datasets`는 관리자 RPC로만.
- **관리자 비밀** — `private.config`에 저장(REST 경로 없음). `set_admin_secret`으로 부트스트랩(git에 값 없음), `verify_admin`이 fail-closed. **현재 개발 기본값(약함) — 실전 전 강화 필요.**
- **`current_price` 권한** — 0018에서 `security definer` 복원, `prosecdef=true` 확인. 재정의 시 유지하라는 코멘트로 회귀 방지.

---

## 4. 검증 현황

### 자동 테스트 — **Vitest 79개 / 6파일 전부 통과** (`npm test`, 2026-08-20 재확인)
- `account.test.js` — 평가금액 파생, 거래정지 −100%, 0 나눗셈 방지.
- `chart.test.js` — 차트 방향 = 실제 등락(회귀), 신규상장 시작점, 결정론성.
- `draw.test.js` — 지우개 선분 판정(회귀).
- `data.test.js` — 종목·힌트·재무·라운드 전수 대조, **호재/악재↔다음 해 등락 일치**.
- `distribute.test.js` — 힌트 라운드로빈(꼴찌부터·하위권 우대·전량 소진).
- `QtyStepper.test.jsx` — 수량 입력 클램프·Esc·전체선택 타이밍(회귀).

### 수동 / 실 DB / 브라우저 검증 이력
- `verify_game.mjs --yes` — 5라운드 풀 시뮬(신규상장 거부→매수·상장폐지 평가액 0·R2~R5 자동 힌트·2025 최종 정산) 통과.
- 브라우저(playwright-core + 시스템 Chrome) — 이번 세션에 실측 확인:
  - 관리자 재구성(탭 2그룹·다음 할 일·**접속 열** 초록), 진행 탭 **데이터셋 선택칸·전환 확인 모달·실제 전환**.
  - 학생 3건(**상장폐지 경고**·타이머 **warn/urgent** 색·**30초 토스트**·순위 변동 형식).
  - 로고 두 테마(라이트=원색/다크=밝은 변형) 헤더·로그인·파비콘, R0 "시작 전 · 대기 중".
- Keep-Alive 워크플로 수동 실행 **성공**("keep-alive 성공 — DB가 깨어 있어요") 확인.

### 아직 커버 안 된 영역
- **실기기 태블릿**(터치·그리기·회전) — 헤드리스만 봄.
- **동시 다접속 부하** — 원격 플레이테스트로 기능은 봤으나 부하 실측은 아님.
- **관리자 화면 컴포넌트 단위 테스트** — 없음(로직은 RPC에서 검증).
- **콘텐츠 정확성** — 테스트는 *내부 정합*(태그↔등락)만. *현실 사실*(실제 재무 수치)은 검증 대상 아님(초안).

---

## 5. 미커밋 변경 / git ↔ DB 정합

- **작업 트리** — 공용 게임 PIN·자율 입장·재무 v4·타이머 재설계 커밋 완료. 마이그레이션 0030~0032 remote 적용 완료.
- **마이그레이션 0001~0032 전부 remote 적용됨** — git과 스키마 일치. (0032 = 리셋 시 공용 게임 PIN 초기화. 현재 라이브 game_pin 없음[발급 전].)
- **라이브 DB 현재 상태(2026-08-20 기준)** — `current_round=0`(시작 전), `active_dataset_id=2`("기본 데이터셋"),
  **`join_mode=open`**(자율 입장으로 전환), 18종목, **조 0개**(TEAM_1~5 삭제·정리 완료), 공용 게임 PIN 미발급(—). *(대회 전 강사가 게임 PIN 발급 → 학생 전달.)*
- **관리자 비밀** — DB `private.config`와 `.env`가 현재 개발 기본값으로 일치(약함, 강화 대기).
- **배포** — Vercel(main 자동), Keep-Alive Actions 시크릿 설정·가동. 도메인 https://cufic-wts.vercel.app.
  ⚠ **배포된 사이트는 아직 옛 클라이언트 코드** — 자율 입장 새 흐름은 `main` push(재배포) 후에 라이브에 반영된다.

---

## 6. 발견된 불일치 / 정리 필요 (문서화 시점 확인)

> 문서 전수 점검 중 코드에서 확인한, "규칙 문서와 실제 코드가 어긋나는" 지점. 기능은 동작하나 정리가 필요하다.

1. ~~**타이머 시작 길이가 UI에서 10분 하드코딩**~~ → **해결(2026-08-20).** [타이머 시작]이 `startTimer(durMin)`으로
   `round_duration_seconds`(게임 설정 값)를 실제로 쓴다. 진행바 기준값도 동일. 타이머 리디자인(헤더 필)과 함께 배선 완료.
2. **`sheet_saved` 신호는 레거시** — 주문서 경로 삭제 후 남은 무해한 신호. 구독부는 무시. 다음 스키마 정리 때 제거 후보.
