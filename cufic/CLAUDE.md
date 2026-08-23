# CUFIC WTS

청소년 교육용 **라운드제 모의투자 WTS**. 학생이 조를 이뤄 참가하고, 강사가 라운드(연도)를
넘기면 주가가 바뀌면서 손익이 발생한다. 재무제표와 시황 뉴스를 근거로 판단하는 법을 가르치는 게 목적.

## 스택

- **React 18 + Vite 5** — 프론트엔드
- **Supabase** (Postgres + Realtime + RPC) — 클라우드, 프로젝트 하나(`cufic_wts`)
- **Vitest** (+ jsdom, @testing-library) — 테스트

## 실행

```bash
npm run dev      # 개발 서버 (5173 점유 시 5174로 뜬다)
npm test         # 전체 테스트
npm run test:watch
npm run build
```

**Supabase 마이그레이션** — 대시보드 수동 편집 금지. 재현 가능해야 한다.

```bash
npx supabase db push          # supabase/migrations/ 를 remote에 적용 (link 완료 상태)
node scripts/gen-seed.mjs     # src/data.js → supabase/seed.sql 생성
```

> **`db push --include-seed`는 새 마이그레이션이 없으면 시드를 건너뛴다.**
> 시드만 다시 넣으려면 Management API로 `supabase/seed.sql`을 직접 실행해야 한다.

**새 DB를 처음 세팅할 때** — 관리자 비밀은 마이그레이션에 없다(git에 남으면 안 되므로).
migrations 적용 후 SQL Editor에서 한 번 실행하고 `.env`의 `VITE_ADMIN_PASSWORD`와 맞춘다:

```sql
select private.set_admin_secret('원하는_비밀');
```

이걸 안 하면 관리자 기능이 전부 `unauthorized`로 잠긴 채 시작한다(의도된 기본값).

## 게임 규칙 (이걸 모르면 코드가 안 읽힌다)

- **즉시 체결 + 라운드 타이머.** 매수·매도를 누르면 서버(`place_order`)가 그 자리에서 체결한다
  (예수금·보유 즉시 반영). 단 거래는 **관리자가 [타이머 시작]을 눌러 연 동안에만** 가능하다 —
  `round_ends_at`이 지나면 서버가 거부(`round_closed`)하고 화면 버튼도 잠긴다. `start_round_timer(p_minutes)`가
  마감 시각을 세우고, 진행 중 `adjust_round_timer`로 ±조정한다.
  - **타이머 길이 = 게임 설정의 `round_duration_seconds`.** [타이머 시작]은 `startTimer(durMin)`으로 그 값을 실제로 쓴다
    (durMin = `round_duration_seconds/60`, 기본 600초=10분). 진행바 기준값도 이 값이다. **타이머 상수를 하드코딩하지 말 것.**
  - **게임 루프.** 관리자가 **[연도 넘기기]**(`advance_round`)를 누르면 그 라운드 평가금액을
    스냅샷하고 다음 연도 가격이 공개된다 → 보유가 재평가돼 **순위가 바뀐다** → 관리자가 순위를
    확인하고 **[타이머 시작]**(`start_round_timer`)으로 거래를 연다. 10분 뒤 자동 마감 → 다시 [연도 넘기기].
  - **타이머 강제는 서버.** `place_order`가 `now() < round_ends_at`을 검사한다. 클라이언트
    카운트다운은 UX용일 뿐 — 마감 뒤 거래는 콘솔로도 못 뚫는다.
  - **주문서 경로는 삭제됨.** 옛 일괄체결 방식(order_sheets·save_order_sheet·order_funds_ok)은
    2025 데이터 이식 때 drop했다(즉시 체결 확정).
- **힌트는 조별로 다르다 — R2부터 자동 차등 지급.** S/A/B/C/D 등급 힌트를 조별로 다르게 준다.
  **R1은 지급 없음.** R2부터 [연도 넘기기]가 **새 순위(가격 공개 후) 기준으로 자동 배분**한다 —
  **하위권 우대(꼴찌=S)**. 강사 수동 지급은 보조로 남는다. 지급 안 된 힌트는 어떤 경로로도 안 보인다.
  - **배분 = 등급순 × 순위 라운드로빈(2026-07-28 확정, floor 공식 폐기).** 힌트 풀을 등급 좋은 순(S→D)·
    같은 등급은 작성순(id)으로 세우고, 팀을 꼴찌부터(평가금액 오름차순, 동률은 생성순→id) 세워 **꼴찌→1위
    방향으로 한 장씩** 소진될 때까지 배정(`hn % 조수`). 로직은 `distribute_round_hints()`(=`src/distribute.js`),
    `advance_round`가 호출. **"직전 정산 순위 = 가격 공개 직후" 해석만 `[잠정]`**(팀 컨펌 대기). 상세 `docs/GAME_RULES.md` §4.
- **리더보드는 연도가 넘어갈 때만 바뀐다.** 라운드 중엔 전 거래가 같은 가격이라 평가금액이
  안 변한다 — 순위는 [연도 넘기기]로 가격이 바뀔 때만 움직인다. 거래별 실시간 순위 갱신은 없다.
- **라운드 수는 데이터셋이 정한다 + 최종 정산.** `total_rounds`·`round_year_map`·`final_year`가 데이터셋마다 다르다
  (현재 기본 데이터셋은 R1~R5 = 2020~2024, 최종 2025). `5` 같은 상수를 하드코딩하지 않는다. 마지막 [대회 종료]
  (`admin_end_game`)가 `final_year` 가격을 공개해 최종 평가금액을 스냅샷한다 —
  `current_round`를 `total_rounds+1`로 올리면 `current_price`가 `final_year`로 폴백한다(거래는 없음).
- **신규상장·상장폐지는 다른 상태.** `stocks.listed_from_round` 이전 라운드엔 목록에서 미노출(상장 예정).
  가격이 0이면 거래정지·평가액 0(상장폐지). 둘을 혼동하지 않는다.
- **입장은 두 방식 — 코드 / 자율 입장.** `game_state.join_mode`(`code`|`open`, 기본 code)가 정한다.
  `code`면 관리자가 만든 참가 코드로(`login_team`), `open`이면 학생이 **닉네임 + 공용 게임 PIN**으로(`join_team`, Kahoot식).
  - **공용 게임 PIN은 게임 하나에 하나.** 강사가 시작 전 무작위 4자리 발급(`admin_set_game_pin`)해 학생 전원에게 전달.
    **`private.config('game_pin')`에 둔다 — `game_state`는 anon이 select로 읽으므로 거기 두면 게이트가 뚫린다**(admin_secret과 동일 원리).
    신호(signals)는 공개 테이블이라 **PIN 값을 payload에 절대 싣지 않는다**(플래그만).
  - 자율 입장은 새 닉네임=조 생성(시작 전만), 기존 닉네임=재접속(공용 PIN 확인). 방식 전환은 시작(R0) 전에만.
  - **PIN은 발급 전까지 없음(`—`)이고, `reset_game`이 초기화한다**(0032, 리셋=새 판 → 강사가 매번 새로 발급). 라운드 넘김·조 삭제로는 안 지워진다.
  - 옛 팀별 `teams.pin`은 0030에서 폐기(파괴적 drop 없이 미사용). 새 코드에서 팀별 PIN을 부활시키지 말 것.
- **콘텐츠 원천은 이제 DB의 데이터셋이다.** 재무·시황·힌트·주가·게임설정 한 벌이 `datasets.payload`(jsonb)에 있고,
  `game_state.active_dataset_id`가 지금 쓰는 벌을 가리킨다. 관리자가 [데이터셋] 탭에서 **엑셀 양식(`datasetXlsx.js`)**
  또는 각 탭 편집으로 만들고 저장한다. 엑셀 업로드는 3단계 리포트 후 **항상 새 데이터셋 생성**(덮어쓰기 아님).
  - **`src/data.js`(생성물)는 "새 DB 초기 템플릿 + 테스트 원천"으로만 남는다.** `seed_*_2025.json` +
    `scripts/build-data.mjs` → `data.js` → `scripts/gen-seed.mjs` → `seed.sql`. 정합성 테스트(`data.test.js`)가 힌트↔주가 방향을 고정.
  - **재무·시황 지표 정의는 `src/metrics.js` 단일 소스.** 재무제표(v4)는 **입력 잎 7개(`FIN_INPUTS`)만 저장**하고
    자산·부채·자본·영업이익·당기순이익·부채비율·ROE는 **`deriveFinancials()`가 계산**한다(`FIN_DERIVED`가 표시 메타). 시황은 `MACRO_METRICS`(6).
    각 항목이 key(camel)/db(snake)/xlsx(엑셀 열)/label/unit을 들고, 모달·편집기·엑셀 파서·`data.js`가 전부 이걸 참조한다.
    **지표를 늘리거나 이름을 바꿀 땐 여기 한 곳만 고친다. 파생값을 DB/시드/payload에 저장하지 않는다**(계산은 `deriveFinancials` 한 곳). 자본 ≤ 0이면 부채비율·ROE는 null(자본잠식).

## 아키텍처 규칙

지키지 않으면 리뷰에서 되돌린다.

- **상태 조작은 반드시 `src/actions.js` 경유.** `App.jsx`에서 setState를 직접 부르지 않는다.
  actions는 전부 `async`이고 `{ok, error?}`를 돌려준다 — Supabase 호출로 바꿔도 호출부가 안 바뀌게.
- **주문의 최종 판정은 서버 RPC.** 프론트 검증은 왕복 전에 막는 UX용일 뿐, 신뢰의 근거가 아니다.
- **낙관적 업데이트 금지.** 서버가 확정한 값으로만 상태를 갱신한다. 교실 네트워크에선 지연이 체감되지 않는다.
- **DB 쓰기는 RPC로만.** 테이블에 insert/update/delete 정책을 만들지 않는다(RLS 기본 거부).
  새 테이블을 만들면 select 정책만 신중히 열고, 쓰기는 `security definer` 함수로.
- **조별 데이터 읽기도 RPC로.** 인증이 없어(anon key + 참가 코드/PIN) RLS가 "자기 조"를 알 수 없다.
  `get_my_hints`처럼 코드를 받는 RPC를 쓴다. `teams` 직접 조회는 막혀 있고
  코드 없는 `public_teams` 뷰만 열려 있다 — 참가 코드가 노출되면 격리가 통째로 무너진다.
- **`teams`를 읽는 함수는 `security definer`여야 한다.** 아니면 RLS에 막혀 조용히 NULL이 된다.
- **관리자 RPC는 `p_admin_secret`을 받아 `private.verify_admin()`으로 검사한다.**
  새 관리자 기능을 만들 때 이걸 빼먹으면 학생이 콘솔에서 게임을 날릴 수 있다.
  - 비밀은 `private.config`에 있다. **`public`에 두면 anon이 select로 읽어 무의미하다** —
    Supabase는 PostgREST에 `public`만 노출하므로 `private`는 REST 경로 자체가 없다.
  - **함수 시그니처를 바꿀 땐 옛 것을 `drop`한다.** `create or replace`로 파라미터만 추가하면
    오버로드가 생겨 무방비 버전이 그대로 살아남는다. 막았다고 착각하기 쉬운 함정.
  - 비밀 미설정 시 전부 거부(fail closed). 새 DB는 잠긴 채 시작한다.
- **금액은 원 단위 정수(bigint).** 부동소수점 금지. 평균단가만 numeric.
- **모든 색상은 CSS 변수.** 하드코딩 금지. 차트 캔들·그리드도 클래스 경유로 변수를 참조한다.
  - 한국 증시 관례: **상승·매수 = `--up`(빨강) / 하락·매도 = `--down`(파랑) / 보합 = `--muted`(중립)**
  - 두 테마(다크·라이트)에서 동일하게 유지
- **`impact`는 `'up' | 'down' | 'flat'`.** DB 체크 제약도 동일. `neutral` 쓰지 않는다.
- **조 수·시드머니 하드코딩 금지.** 관리자가 화면에서 설정한다. `num_of_team = 7` 같은 상수를 만들지 않는다.
- **데이터를 고치면 정합성 테스트가 지켜져야 한다.** 특히 뉴스의 호재·악재 태그는 다음 라운드
  실제 등락과 일치해야 한다(`src/data.test.js`). 어긋나면 정직하게 판단한 학생이 손해를 본다.
- **가격 0 = 거래정지.** 매수·매도 차단, 평가액 0. 0으로 나누는 코드를 만들지 않는다.

## 환경

`.env` (커밋 금지, 형식은 `.env.example` 참고)

- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — 브라우저에 노출되는 게 정상. 비밀이 아니다.
  실제 보안은 RLS와 RPC 내부 검증이 담당한다.
- `VITE_ADMIN_PASSWORD` — 관리자 화면. 코드에 하드코딩하지 않는다.
- `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` — CLI 전용. **진짜 비밀.**

**프로젝트는 하나다** — `cufic_wts` (`zhwidhvoxcoljffvqhol`, 서울). 개발도 대회도 여기서 돈다.
분리된 개발 DB가 없으므로:

- 검증용 주문은 **테스트 조 코드(`TEST-XX`)로만** 태운다. 실제 조 데이터를 건드리지 않는다.
- 마이그레이션이 곧 실서비스에 적용된다. **스키마 변경은 되돌릴 여유가 없다고 보고 신중히.**
- **대회 전 `reset_game` 초기화 리허설 필수.** 안 하면 학생 화면에 테스트 흔적이 보인다.

## 대상 기기

- **태블릿 가로 + 노트북.** 1280px 이상 기준, 1024~1279px는 축소 레이아웃.
- 세로 화면(1023px 이하)에선 회전 안내가 전체를 덮는다 — CSS 미디어 쿼리만으로 처리(JS 감지 없음).
- **터치 영역 44px 이상.** `(max-width: 1279px), (pointer: coarse)`에서 적용.
- **hover 전용 기능 금지.** 툴팁은 탭으로 열린다. `title` 속성에 정보를 숨기지 않는다.
- 페이지 스크롤은 구조적으로 불가능하다(flex 체인 + `body{overflow:hidden}`). 넘치는 건 각 패널이 내부에서 처리.

## 검증

빌드 통과만으로 "된다"고 하지 않는다. 실제 브라우저로 조작해 확인한다 —
`chromium-cli`가 없어 스크래치패드에 `playwright-core`를 두고 시스템 Chrome을 붙여 쓴다
(프로젝트 `package.json`은 건드리지 않는다).

> 브라우저 콘솔에서 `import('/src/data.js')`로 모듈을 바꿔치기하는 검증은 **믿지 말 것.**
> Vite HMR이 `?t=` 쿼리를 붙여 서빙해서 별개 복사본이 잡히고 앱 데이터는 안 바뀐다.
> 실제 파일을 잠깐 고쳐 확인하고 되돌린다.

## 문서

> 누가 무엇을 읽나: `README.md`의 "문서 지도" 표 참조(강사·교보재팀·개발자·모두).

- `docs/DECISIONS.md` — 왜 그렇게 했는지. **큰 결정이 생기면 여기에 추가한다.**
- `docs/ROADMAP.md` — 현재 위치와 남은 일.
- `docs/STATUS.md` — 현재 상태의 완전한 스냅샷(진행률·파일 지도·DB·검증 + §6 발견된 불일치). 외부 검수·인수인계용.
- `docs/GAME_RULES.md` — 확정된 게임 규칙서(모델 v3·라운드·힌트·입장 방식·밸런스, 미확정은 `[팀 확인 대기]`).
- `docs/DATA_GUIDE.md` — 데이터 형식·정합성·파일 파이프라인 참조(개발자·심화).
- `docs/MANUAL_CONTENT.md` — 콘텐츠 제작자용(엑셀 양식·관리자 화면으로 데이터 만드는 법).
- `docs/SCREENS.md` — 전 화면·버튼 설명서(학생·관리자). *(옛 `function_btn.md`는 여기로 병합·삭제됨.)*
- `docs/OPERATIONS.md` — 대회 당일 운영 순서(⚠ 리허설 전 초안).
- `docs/MANUAL_ADMIN.md` — 강사용 관리자 화면 조작 매뉴얼(실제 버튼·순서).

규칙이 바뀌면 이 파일을, 판단의 근거가 생기면 `DECISIONS.md`를, 현황이 바뀌면 `STATUS.md`를 갱신한다.
