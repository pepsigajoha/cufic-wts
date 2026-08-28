# CUFIC WTS

청소년 교육용 **라운드제 모의투자 WTS**. 학생이 조를 이뤄 참가하고, 강사(관리자)가 라운드(연도)를
넘기면 주가가 바뀌며 손익이 난다. 재무제표·시황·힌트를 근거로 판단하는 법을 가르치는 게 목적.

- **즉시 체결 + 라운드 타이머.** 매수·매도를 누르면 서버가 그 자리에서 체결한다. 단 거래는 관리자가
  [타이머 시작]으로 연 동안에만 가능하다(기본 10분, 서버가 마감을 강제). [다음 연도로 넘어가기]를 누르면
  다음 해 가격이 공개돼 순위가 바뀌고, R2부터 힌트가 순위대로 자동 배분된다.
- **학생 화면** `/` — 참가 코드 **또는 닉네임+PIN(자율 입장)**으로 입장, 즉시 매매, 차트·재무제표·시황·힌트, 조별 순위.
- **관리자 화면** `/?admin=1` — 데이터셋 선택·라운드 진행·타이머·속보·힌트·조/종목 관리·리더보드(프로젝터)·결과 내보내기.

**React 18 + Vite 5 · Supabase(Postgres + Realtime + RPC) · Vitest.** 배포: <https://cufic-wts.vercel.app> (관리자 `/?admin=1`).

## 📚 문서 지도 — 누가 무엇을 읽나

| 역할 | 먼저 볼 문서 |
|---|---|
| **강사(운영)** | [OPERATIONS](docs/OPERATIONS.md) 당일 순서 · [MANUAL_ADMIN](docs/MANUAL_ADMIN.md) 관리자 화면 조작 · [GAME_RULES](docs/GAME_RULES.md) 규칙 |
| **교보재팀(제작)** | [MANUAL_CONTENT](docs/MANUAL_CONTENT.md) 엑셀/화면으로 데이터 만들기 · [DATA_GUIDE](docs/DATA_GUIDE.md) 형식·정합성 참조 |
| **개발자(유지보수)** | [STATUS](docs/STATUS.md) 현황 스냅샷 · [DECISIONS](docs/DECISIONS.md) 왜 그렇게 했나 · [CLAUDE.md](CLAUDE.md) 아키텍처 규칙 · [ROADMAP](docs/ROADMAP.md) 남은 일 |
| **모두(참조)** | [SCREENS](docs/SCREENS.md) 전 화면·버튼 설명 |

## 로컬 실행

```bash
git clone https://github.com/ms4317/cufic-wts.git
cd cufic-wts
npm install
cp .env.example .env      # 값을 채운다 (아래 참고)
npm run dev               # http://localhost:5173 (관리자 http://localhost:5173/?admin=1)
npm test                  # Vitest
npm run build
```

> ⚠️ **Supabase 프로젝트는 하나뿐이고, 개발도 대회도 같은 DB에서 돈다** (`cufic_wts`, 서울 리전).
> 로컬 `.env`를 채우는 순간 이 공용 DB에 바로 연결된다 — 라운드 타이머를 시작·조정하거나
> 주가를 적용하는 등 상태를 바꾸는 조작은 **실제 대회/다른 팀원의 리허설에 그대로 반영된다.**
> 검증용 주문은 반드시 테스트 조 코드(`TEST-XX`)로만 태우고, 스키마를 바꾸는 마이그레이션은
> 신중하게 다룬다. 자세한 아키텍처 규칙은 [CLAUDE.md](CLAUDE.md) 참고(신규 합류 개발자는 필독).

### .env

| 키 | 설명 | 비밀 | 배포에 필요? |
|---|---|---|---|
| `VITE_SUPABASE_URL` | Supabase Project URL | 아니오 | **예** |
| `VITE_SUPABASE_ANON_KEY` | anon public key — 브라우저 노출이 정상 | 아니오 | **예** |
| `VITE_ADMIN_PASSWORD` | 관리자 비밀번호. DB의 admin_secret과 같게. 관리자 로그인 때 입력하며 **번들엔 안 들어간다** | **예** | 아니오 |
| `SUPABASE_ACCESS_TOKEN` | CLI 전용 (마이그레이션 push, seed 실행) | **예** | 아니오 |
| `SUPABASE_DB_PASSWORD` | CLI 전용 | **예** | 아니오 |

anon key는 RLS와 RPC 검증이 보호하므로 공개돼도 된다. `.env`는 커밋되지 않는다(`.gitignore`).

## Supabase 세팅

대시보드에서 스키마를 손으로 만들지 않는다 — 재현 가능해야 한다.

```bash
npx supabase link --project-ref <ref>
npx supabase db push          # supabase/migrations/ 전체 적용
```

**콘텐츠(데이터)의 원천은 이제 DB다.** 관리자 화면([데이터셋] 탭)에서 **엑셀 양식으로 통째로** 만들거나
각 탭에서 직접 편집한다 → [MANUAL_CONTENT](docs/MANUAL_CONTENT.md). `src/data.js`(생성물)는 **새 DB의 초기
템플릿**용으로만 남아 있다.

```bash
node scripts/build-data.mjs   # JSON(주가·재무)+소개·힌트 → src/data.js (초기 템플릿)
node scripts/gen-seed.mjs     # src/data.js → supabase/seed.sql
```

> `db push --include-seed`는 **새 마이그레이션이 없으면 시드를 건너뛴다.** 시드만 다시 넣으려면
> Management API로 `supabase/seed.sql`을 직접 실행한다. 자세한 절차는 [DATA_GUIDE](docs/DATA_GUIDE.md).

**관리자 비밀번호** — 마이그레이션에 없다(git에 남으면 안 되므로). SQL Editor에서 한 번 실행하고
`.env`의 `VITE_ADMIN_PASSWORD`와 맞춘다:

```sql
select private.set_admin_secret('원하는_비밀');
```

이걸 안 하면 관리자 기능이 전부 `unauthorized`로 잠긴 채 시작한다(의도된 fail-closed 기본값).

## 배포

**이미 Vercel에 배포돼 있다** — <https://cufic-wts.vercel.app> (관리자 `/?admin=1`). `main`에 push하면 자동 재배포.
백엔드는 클라우드(Supabase)라 프론트만 정적 호스팅하면 어디서든 접속된다.

- 새로 붙일 때: GitHub 저장소를 Vercel에서 Import(Framework=Vite 자동, `npm run build`→`dist`), 환경변수 **두 개**
  (`VITE_SUPABASE_URL`·`VITE_SUPABASE_ANON_KEY`)만 등록. 관리자 비밀번호는 번들에 없으니 등록 불필요.
- **Keep-Alive**: 무료 플랜은 ~1주 무요청 시 DB를 재우므로, GitHub Actions(`.github/workflows/keepalive.yml`)가
  매일 핑을 보낸다. 저장소 시크릿 `SUPABASE_URL`·`SUPABASE_ANON_KEY` 필요.

## 게임 진행 (관리자, 요약)

1. **[데이터셋]** — 쓸 데이터셋을 [편집]으로 불러오거나 [진행] 탭 드롭다운에서 고른다.
2. **[조 관리]** — 코드 방식이면 조·코드를 만들어 배부. 자율 입장이면 학생이 닉네임으로 직접 입장(게임 설정에서 방식 선택).
3. **[진행]** → **[대회 시작]**(R1) → **[타이머 시작]**(10분)으로 거래를 연다.
4. 학생 즉시 매매 → 타이머 만료로 자동 마감.
5. **[다음 연도로 넘어가기]** → 다음 해 가격 공개 + 순위 변동 + (R2부터) 힌트 자동 배분 → 다시 [타이머 시작]. 반복.
6. **[대회 종료]** → 최종 정산 연도 가격으로 최종 정산 + 전 학생 종료 모달. [리더보드] → **[대회 결과 내보내기]**.

**시작 전 반드시** — [게임 리셋]으로 초기화하고 테스트/플레이테스트 조를 지운다(개발 DB가 곧 실서비스 DB).
당일 운영 순서는 [OPERATIONS](docs/OPERATIONS.md), 화면 조작은 [MANUAL_ADMIN](docs/MANUAL_ADMIN.md).

## 구조

**상태 흐름은 단방향이다.** 서버 상태는 `App.jsx`(학생) / `Admin.jsx`(관리자)만 들고 있고, `Chart.jsx`·
`StockList.jsx` 같은 하위 컴포넌트는 props로만 값을 받는 순수 표시 컴포넌트다 — 자기 마음대로 서버 상태를
바꾸지 않고, 조작은 전부 `actions.js`의 함수를 호출해 위로 올린다(자세한 규칙은 [CLAUDE.md](CLAUDE.md)).

```
src/
  App.jsx         최상위 (?admin이면 관리자, 아니면 학생). 상태·모달 오케스트레이션
  supabase.js     Supabase 클라이언트 + rpc/select 래퍼 + 에러 문구
  gameData.js     서버 상태를 화면용으로 가공, 실시간 신호 구독
  actions.js      상태를 바꾸는 동작 (학생·관리자). 전부 async {ok, error}
  auth.js         입장 (login_team=코드 / join_team=자율 입장 닉네임·PIN)
  account.js      평가금액·손익 계산
  chart.js        가격 경로 생성기 (종목코드 시드, 결정론적). 실시간 세부 눈금 간격은
                  SUB_TICK_INTERVAL_MS 상수 하나로 조절 — 값만 바꾸면 나머지가 자동으로 맞춰진다
  metrics.js      재무·시황 지표 정의 단일 소스 (모달·편집·엑셀 파서가 참조)
  distribute.js   힌트 자동 배분 (등급순 × 순위 라운드로빈)
  dataCheck.js    콘텐츠 정합성 검사 (관리자 [데이터 점검])
  data.js         자동 생성 — 새 DB 초기 템플릿 + 테스트 원천
  components/     학생 화면
  admin/          관리자 화면 (7탭) + datasetXlsx.js(엑셀 왕복)
supabase/
  migrations/     스키마·RPC. 순서대로 적용된다 (현재 0001~0032)
  seed.sql        자동 생성 — 직접 고치지 말 것
scripts/
  build-data.mjs  JSON + 소개·힌트 → src/data.js
  gen-seed.mjs    src/data.js → supabase/seed.sql
  verify_game.mjs 5라운드 실 DB 시뮬 검증 (--yes, reset 포함 — 대회 중 금지)
docs/             문서 (위 "문서 지도" 참고)
```
