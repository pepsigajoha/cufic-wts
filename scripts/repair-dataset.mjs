// 현재 DB 가격에 맞춰 재무제표·힌트를 다시 만들어 반영한다 (일회성 보정).
//
// 주가 생성기를 이미 돌려서 가격만 바뀌고 재무·힌트가 어긋난 데이터셋을 고칠 때 쓴다.
// buildDerivedContent(시뮬레이터가 쓰는 것과 같은 함수)로 계산하고,
// admin_apply_generated_content RPC 로 쓴다.
//
// 사용:
//   node scripts/repair-dataset.mjs [관리자비밀]            ← 계산만 (dry-run)
//   node scripts/repair-dataset.mjs [관리자비밀] --apply    ← 실제 반영
//   SUPABASE_URL / SUPABASE_ANON_KEY / ADMIN_SECRET env 로 대상 DB 지정 가능

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { buildDerivedContent } from '../src/admin/simContent.js'

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trimStart().startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)
const URL_ = process.env.SUPABASE_URL || env.VITE_SUPABASE_URL
const KEY = process.env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY
const SECRET = process.argv[2]?.startsWith('--') ? '' : process.argv[2]
const ADMIN = SECRET || process.env.ADMIN_SECRET || env.VITE_ADMIN_PASSWORD || ''
const APPLY = process.argv.includes('--apply')
if (!URL_ || !KEY) {
  console.error('.env 에 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 없습니다.')
  process.exit(2)
}

const sb = createClient(URL_, KEY)
const must = async (p, label) => {
  const { data, error } = await p
  if (error) throw new Error(`${label}: ${error.message}`)
  return data
}

const game = (await must(sb.from('game_state').select('*'), 'game_state'))[0] ?? {}
const stocks = await must(sb.from('stocks').select('*'), 'stocks')
const financials = await must(sb.rpc('admin_list_financials', { p_admin_secret: ADMIN }), 'admin_list_financials')
const macro = await must(sb.rpc('admin_list_macro', { p_admin_secret: ADMIN }), 'admin_list_macro')
const hintsRes = await must(sb.rpc('admin_list_hints', { p_admin_secret: ADMIN }), 'admin_list_hints')
if (hintsRes?.ok === false) {
  console.error('관리자 비밀번호 불일치/미설정.')
  process.exit(2)
}

const rym = game.round_year_map ?? {}
const allYears = [...new Set(Object.values(rym).map(Number))].sort((a, b) => a - b)
const finalYear = game.final_year != null ? Number(game.final_year) : null
const regenYears = allYears.slice(1) // 첫 연도 = 앵커, 나머지 전부 재생성

const prices = Object.fromEntries(stocks.map((s) => [s.id, s.prices ?? {}]))
const macroByYear = Object.fromEntries(
  macro.map((m) => [Number(m.year), { rate: Number(m.rate), cpi: Number(m.cpi) }]),
)

const { financials: finRows, hints, replaceRounds, check } = buildDerivedContent({
  prices,
  stocks,
  financials,
  macroByYear,
  roundYearMap: rym,
  finalYear,
  regenYears,
})

console.log('─'.repeat(60))
console.log(`DB       : ${URL_}`)
console.log(`앵커 연도 : ${allYears[0]}   재생성   : ${regenYears.join(', ')}`)
console.log(`재무     : ${finRows.length}행`)
console.log(`힌트     : ${hints.length}개  (R${replaceRounds.join(', R') || '—'} 교체)`)
console.log(`self-check: 힌트↔등락 ${check.checked}건 대조, 불일치 ${check.mismatches.length}`)
if (check.mismatches.length) {
  for (const m of check.mismatches) console.log('  - ' + m)
  console.error('\n불일치가 있어 중단합니다.')
  process.exit(1)
}
console.log('─'.repeat(60))

if (!APPLY) {
  console.log('dry-run. 실제 반영하려면 --apply 를 붙이세요.')
  process.exit(0)
}

const { data, error } = await sb.rpc('admin_apply_generated_content', {
  p_admin_secret: ADMIN,
  p_financials: finRows,
  p_hints: hints,
  p_replace_hint_rounds: replaceRounds,
})
if (error) {
  console.error('RPC 실패:', error.message)
  process.exit(1)
}
console.log('반영됨:', JSON.stringify(data))
