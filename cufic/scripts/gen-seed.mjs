// src/data.js → supabase/seed.sql 생성기
//
// data.js는 build-data.mjs가 JSON에서 생성한다. 시드를 손으로 쓰지 않고 data.js에서 뽑는 이유:
// 정합성 테스트(data.test)가 data.js를 검사하는데, 시드를 따로 관리하면 DB와 테스트가
// 다른 데이터를 보게 된다. 원천을 하나(data.js)로 묶어 어긋날 수 없게 한다.
//
//   node scripts/build-data.mjs   # JSON → src/data.js
//   node scripts/gen-seed.mjs     # src/data.js → supabase/seed.sql
//
// 시드는 마이그레이션 뒤에 적용된다(game_state.final_year 컬럼은 마이그레이션이 만든다).

import { writeFileSync } from 'fs'
import { PRINCIPAL, ROUNDS, FINAL_YEAR, stocks, initialHints, financials, MACRO } from '../src/data.js'

const q = (s) => `'${String(s).replace(/'/g, "''")}'`
const jsonb = (o) => `${q(JSON.stringify(o))}::jsonb`

const roundYearMap = Object.fromEntries(ROUNDS.map((r) => [r.round, r.year]))

const lines = []
const w = (s = '') => lines.push(s)

w('-- 자동 생성 파일 — 직접 고치지 말 것.')
w('-- 원천은 src/data.js (build-data.mjs가 JSON에서 생성). 고치려면 JSON을 고치고')
w('-- `node scripts/build-data.mjs && node scripts/gen-seed.mjs` 실행.')
w('--')
w('-- 콘텐츠(주가·재무·힌트)는 팀 검토 전 초안이다. 대회 전 확정할 것.')
w()
w('begin;')
w()
w('-- 재적용 가능하게: 기존 데이터를 지우고 다시 넣는다')
w('-- (where true는 Supabase safeupdate 가드 때문 — WHERE 없는 DELETE는 거부된다)')
w('delete from round_snapshots where true;')
w('delete from trades where true;')
w('delete from positions where true;')
w('delete from hint_grants where true;')
w('delete from broadcasts where true;')
w('delete from hints where true;')
w('delete from financials where true;')
w('delete from macro where true;')
w('delete from teams where true;')
w('delete from stocks where true;')
w('delete from game_state where true;')
w()
w('-- 시드는 몇 번을 돌려도 같은 상태여야 한다. identity 시퀀스를 되돌리지 않으면')
w('-- 재시드할 때마다 id가 밀려 "1번 힌트"를 참조하는 것들이 조용히 어긋난다.')
w('alter sequence hints_id_seq restart with 1;')
w('alter sequence trades_id_seq restart with 1;')
w('alter sequence broadcasts_id_seq restart with 1;')
w()

// ── game_state
w('-- 게임 설정. current_round=0 = 시작 전. R1~R5(2020~2024) 매매, 종료 시 final_year(2025) 정산.')
w(
  `insert into game_state (id, current_round, total_rounds, round_year_map, default_seed, is_locked, final_year, round_duration_seconds)\n` +
    `values (1, 0, ${ROUNDS.length}, ${jsonb(roundYearMap)}, ${PRINCIPAL}, false, ${FINAL_YEAR}, 600);`,
)
w()

// ── stocks
w('-- 종목. prices 값이 없거나 0이면 거래정지. listed_from_round 이전 라운드엔 상장 전(미노출).')
w('insert into stocks (id, name, description, listed_from_round, prices, display_order) values')
w(
  stocks
    .map(
      (s) =>
        `  (${q(s.code)}, ${q(s.name)}, ${q(s.desc ?? '')}, ${s.listedFromRound}, ${jsonb(s.priceByYear)}, ${s.displayOrder})`,
    )
    .join(',\n') + ';',
)
w()

// ── financials (재무제표). 값이 없는 연도(미상장/폐지)는 행을 넣지 않는다.
w('-- 재무제표. 미상장/폐지 연도는 행 없음(화면에서 "-").')
const finRows = []
for (const [code, years] of Object.entries(financials)) {
  for (const [year, v] of Object.entries(years)) {
    if (!v) continue
    finRows.push(
      `  (${q(code)}, ${year}, ${v.currentAssets}, ${v.noncurrentAssets}, ${v.currentLiabilities}, ${v.noncurrentLiabilities}, ${v.revenue}, ${v.operatingExpense}, ${v.nonoperatingExpense})`,
    )
  }
}
w(
  'insert into financials (stock_id, year, current_assets, noncurrent_assets, current_liabilities, noncurrent_liabilities, revenue, operating_expense, nonoperating_expense) values',
)
w(finRows.join(',\n') + ';')
w()

// ── macro (시황)
w('-- 시황(거시경제 지표 + 한 줄 요약).')
w('insert into macro (year, summary, kospi, sp500, nikkei, europe, rate, cpi, oil, gold) values')
w(
  Object.entries(MACRO)
    .map(
      ([year, m]) =>
        `  (${year}, ${q(m.summary)}, ${m.kospi}, ${m.sp500}, ${m.nikkei}, ${m.europe}, ${m.rate}, ${m.cpi}, ${m.oil}, ${m.gold})`,
    )
    .join(',\n') + ';',
)
w()

// ── hints
w('-- 등급 힌트(S~D). R1은 없음. [연도 넘기기]가 R2부터 순위대로 자동 배분한다(distribute_round_hints).')
w('-- 지급 기록(hint_grants)은 비워둔다. 지급되지 않은 힌트는 어떤 경로로도 안 보인다.')
w('insert into hints (round, grade, headline, impact, related_stock_ids) values')
w(
  initialHints
    .map((h) => {
      const arr = h.related.length ? `array[${h.related.map(q).join(',')}]::text[]` : `'{}'::text[]`
      return `  (${h.round}, ${q(h.grade)}, ${q(h.headline)}, ${q(h.impact)}, ${arr})`
    })
    .join(',\n') + ';',
)
w()

// ── teams
w('-- 검증용 조. 대회 전에 반드시 지우고 실제 조로 교체할 것.')
w('insert into teams (code, name, seed, cash) values')
w(`  ('TEST-01', '검증용', 100000, 100000),`)
w(`  ('TIGER-03', '호랑이 3조', ${PRINCIPAL}, ${PRINCIPAL});`)
w()
w('commit;')
w()

writeFileSync(new URL('../supabase/seed.sql', import.meta.url), lines.join('\n'), 'utf8')
console.log(`seed.sql 생성 — 종목 ${stocks.length}, 힌트 ${initialHints.length}, 라운드 ${ROUNDS.length}, FINAL ${FINAL_YEAR}`)
