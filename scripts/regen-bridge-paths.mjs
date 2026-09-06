// 전체 종목의 stock_price_paths를 "브리지 트랙"으로 전면 재보간한다.
// 실제 알고리즘은 DB의 private.bridge_path / private.regen_all_bridge_paths (마이그레이션 45)에
// 있다 — 이 스크립트는 그걸 한 번 호출할 뿐이다(엑셀·수동 편집이 아닌 최초 초기화용).
//
// 트랙 2(주가 생성기)로 만든 source='engine' 경로는 기본적으로 보존한다.
//   --force  로 엔진 경로까지 전부 브리지로 덮는다.
//
// 실행: node scripts/regen-bridge-paths.mjs [--ref <ref>] [--force]

import { readFileSync } from 'node:fs'

const arg = (n, d) => {
  const i = process.argv.indexOf(n)
  return i !== -1 ? process.argv[i + 1] : d
}
const REF = arg('--ref', 'dqvcagrbkvhnetqydgnk')
const FORCE = process.argv.includes('--force')

const env = Object.fromEntries(
  readFileSync('.env.prod-backup', 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)
const TOKEN = env.SUPABASE_ACCESS_TOKEN
if (!TOKEN) throw new Error('.env.prod-backup 에 SUPABASE_ACCESS_TOKEN 없음')

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 500)}`)
  return t ? JSON.parse(t) : []
}

const rows = await sql(`select private.regen_all_bridge_paths(${FORCE}) as n`)
console.log(`대상 ${REF}${FORCE ? ' · FORCE(엔진 경로 포함)' : ''} — 브리지 경로 ${rows[0].n}건 재생성`)
const stats = await sql(`
  select source, count(*) rows,
    count(*) filter (where (select min(v) from unnest(prices) v) <> (select max(v) from unnest(prices) v)) as n_varying
  from stock_price_paths group by source order by source`)
console.log(JSON.stringify(stats, null, 1))
