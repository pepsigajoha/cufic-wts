// 장중 스텝 인덱스 공식이 JS(src/chart.js roundStepIndex)와 SQL(private.round_step_idx,
// 20260830000043) 사이에서 같은 값을 내는지 대조 검증한다.
//
// 두 구현이 어긋나면 학생 차트가 그리는 "지금 스텝"과 place_order가 체결하는 스텝이 달라져,
// 화면에서 본 가격과 실제 체결가가 조용히 어긋난다 — 이 게임에서 가장 피해야 할 회귀다.
//
// SQL의 round_step_idx()는 game_state와 now()를 직접 읽으므로 그대로는 격자 테스트가
// 안 된다. 대신 마이그레이션에 박아 둔 "공식 그 자체"(진행률 × 252, least/greatest/floor)를
// select로 평가해 JS와 비교한다. 게임 상태는 전혀 건드리지 않는다(대회 중 실행해도 안전).
//
// 실행: node scripts/verify-intraday-step-parity.mjs [--ref <project-ref>]

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { roundStepIndex, STEPS_PER_YEAR } from '../src/chart.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ENV_PATH = join(HERE, '..', '.env')

const env = Object.fromEntries(
  readFileSync(ENV_PATH, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const refArgIdx = process.argv.indexOf('--ref')
const REF =
  refArgIdx !== -1
    ? process.argv[refArgIdx + 1]
    : env.VITE_SUPABASE_URL?.match(/https:\/\/([a-z0-9]+)\.supabase/)?.[1]
const TOKEN = env.SUPABASE_ACCESS_TOKEN
if (!REF || !TOKEN) {
  console.error('중단: .env에 VITE_SUPABASE_URL / SUPABASE_ACCESS_TOKEN이 필요하다.')
  process.exit(1)
}

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`SQL ${r.status}: ${t}`)
  return t ? JSON.parse(t) : []
}
const q = (s) => `'${String(s).replace(/'/g, "''")}'`

// SQL 쪽: round_step_idx() 본문의 공식을 그대로(파라미터만 바깥에서 주입해) 평가.
async function sqlStepIdx(startIso, endIso, nowIso) {
  const rows = await sql(`
    with p as (select
      extract(epoch from ${q(startIso)}::timestamptz) s,
      extract(epoch from ${q(endIso)}::timestamptz)   e,
      extract(epoch from ${q(nowIso)}::timestamptz)   n)
    select case
      when (e - s) <= 0 then ${STEPS_PER_YEAR - 1}
      else least(${STEPS_PER_YEAR - 1}, greatest(0, floor(((n - s) / (e - s)) * ${STEPS_PER_YEAR})::int))
    end v from p`)
  return Number(rows[0].v)
}

const T0 = Date.parse('2026-08-30T00:00:00Z')
const iso = (ms) => new Date(ms).toISOString()

const CASES = []
for (const durMin of [5, 10, 15, 47]) {
  const end = T0 + durMin * 60_000
  for (const fracPct of [-5, 0, 1, 13, 25, 37, 50, 63, 75, 88, 99, 100, 101, 150]) {
    CASES.push({ start: T0, end, now: T0 + Math.round(((end - T0) * fracPct) / 100), label: `${durMin}분 · ${fracPct}%` })
  }
}
// span<=0 방어 케이스
CASES.push({ start: T0 + 600_000, end: T0, now: T0 + 60_000, label: 'span<=0(끝<시작)' })

async function main() {
  console.log('=== round_step_idx JS ↔ SQL 대조 검증 ===\n')
  let pass = 0
  let fail = 0
  for (const c of CASES) {
    const jsVal = roundStepIndex(
      { round_start_at: iso(c.start), round_ends_at: iso(c.end) },
      c.now,
    )
    const sqlVal = await sqlStepIdx(iso(c.start), iso(c.end), iso(c.now))
    const ok = jsVal === sqlVal
    if (ok) pass++
    else fail++
    console.log(`  ${ok ? '✅' : '❌'} ${c.label}  JS=${jsVal}  SQL=${sqlVal}`)
  }
  console.log(`\n통과 ${pass} / 실패 ${fail} / 총 ${pass + fail}건`)
  if (fail > 0) {
    console.log('\n일치하지 않는다 — chart.js roundStepIndex와 migration 20260830000043의 공식을 맞출 것.')
    process.exitCode = 1
  }
}

main()
