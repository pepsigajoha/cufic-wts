// private.tick_price(SQL) 와 src/realtimeTick.js의 tickPrice(JS) 가 같은 입력에
// 같은 값을 내는지 대조 검증한다. 20260826000037(place_order가 tick_price로 체결)을
// push하기 전에 반드시 이 스크립트로 먼저 확인할 것 — 두 구현이 어긋난 채로 체결가에
// 쓰면 학생이 화면에서 본 가격과 실제 체결가가 조용히 달라진다.
//
// 게임 상태를 전혀 건드리지 않는다(reset_game 등 호출 없음) — 순수 함수 값만 조회하므로
// 대회 중에 실행해도 안전하다.
//
// 실행: node scripts/verify-tick-price-parity.mjs
// verify_game.mjs와 동일하게 Management API(SUPABASE_ACCESS_TOKEN)로 SQL을 직접 실행한다
// (private 스키마는 PostgREST/anon RPC로 못 부르므로 이 경로가 유일하다).

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tickPrice } from '../src/realtimeTick.js'

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

// --ref <project-ref>로 .env와 다른 프로젝트(예: dev DB)를 대상으로 돌릴 수 있다.
// 기본은 .env의 VITE_SUPABASE_URL.
const refArgIdx = process.argv.indexOf('--ref')
const REF = refArgIdx !== -1 ? process.argv[refArgIdx + 1] : env.VITE_SUPABASE_URL?.match(/https:\/\/([a-z0-9]+)\.supabase/)?.[1]
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

async function sqlTickPrice({ officialPrice, seed, stockId, now, remainingMs, taperMs = 15_000, sigma = 0.03 }) {
  const atIso = new Date(now).toISOString()
  const rows = await sql(
    `select private.tick_price(${officialPrice}, ${seed}, ${q(stockId)}, ${q(atIso)}::timestamptz, ${remainingMs}, ${taperMs}, ${sigma}) v`,
  )
  return Number(rows[0].v)
}

// realtimeTick.test.js에 있는 경계·회귀 케이스를 그대로 재사용한다 — JS 쪽 회귀 테스트와
// 같은 벡터로 SQL 이식본을 검증해야 "JS만 통과, SQL은 다른 값"인 상황을 놓치지 않는다.
const BASE = { officialPrice: 10_000, seed: 3, stockId: 'S01' }
const CASES = [
  { name: '경계: 잔여시간 0(마감) → 공식가', input: { ...BASE, remainingMs: 0, now: 0 } },
  { name: '경계: 잔여시간 음수(마감 지남) → 공식가', input: { ...BASE, remainingMs: -5_000, now: 0 } },
  { name: '충분한 잔여시간, now=63000', input: { ...BASE, remainingMs: 300_000, now: 63_000 } },
  { name: '충분한 잔여시간, now=7000', input: { ...BASE, remainingMs: 300_000, now: 7_000 } },
  { name: '충분한 잔여시간, now=11000', input: { ...BASE, remainingMs: 300_000, now: 11_000 } },
  { name: '다른 종목코드(S02)', input: { ...BASE, stockId: 'S02', remainingMs: 300_000, now: 63_000 } },
  { name: '다른 라운드(seed=4)', input: { ...BASE, seed: 4, remainingMs: 300_000, now: 63_000 } },
  { name: '큰 now (라운드가 오래 진행됨)', input: { ...BASE, remainingMs: 300_000, now: 10_015_000 } },
  { name: '저가 종목(officialPrice=100)', input: { ...BASE, officialPrice: 100, remainingMs: 300_000, now: 90_000 } },
  { name: '고가 종목(officialPrice=987650)', input: { ...BASE, officialPrice: 987_650, remainingMs: 120_000, now: 45_000 } },
  { name: '수렴 구간 경계(taperMs 근처, remainingMs=14000)', input: { ...BASE, remainingMs: 14_000, now: 200_000 } },
]

async function main() {
  console.log('=== tick_price JS ↔ SQL 대조 검증 ===\n')
  let pass = 0
  let fail = 0

  for (const c of CASES) {
    const jsVal = tickPrice(c.input)
    const sqlVal = await sqlTickPrice(c.input)
    const ok = jsVal === sqlVal
    console.log(`  ${ok ? '✅' : '❌'} ${c.name}  JS=${jsVal}  SQL=${sqlVal}`)
    ok ? pass++ : fail++
  }

  console.log(`\n통과 ${pass} / 실패 ${fail} / 총 ${pass + fail}건`)
  if (fail > 0) {
    console.log('\n일치하지 않는다 — 20260826000037은 이 문제를 고치기 전엔 push하지 말 것.')
    process.exitCode = 1
  }
}

main()
