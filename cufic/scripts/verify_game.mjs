// 5라운드 게임 풀 시뮬레이션 검증 (새 데이터).
//
// ⚠ 이 스크립트는 reset_game으로 게임을 통째로 초기화한다. 개발·검증용이며 대회 중 실행 금지.
//    안전장치로 `--yes` 인자를 요구한다:  node scripts/verify_game.mjs --yes
//
// Management API로 RPC를 호출해(관리자 비밀·anon 대신 postgres 롤) 서버 로직을 그대로 태운다.
// 검증 항목: 신규상장(listed_from_round) 매매 차단→개방, 상장폐지 평가액 0,
//            R2~R5 자동 힌트 배분, 대회 종료 시 final_year(2025) 최종 정산.

import { readFileSync } from 'node:fs'

if (!process.argv.includes('--yes')) {
  console.error('중단: 이 스크립트는 게임을 리셋한다. 확인했으면 `--yes`를 붙여 실행하라.')
  process.exit(1)
}

const ROOT = 'C:/Users/alstm/OneDrive/바탕 화면/cufic-wts'
const env = Object.fromEntries(
  readFileSync(ROOT + '/.env', 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }),
)
const REF = env.VITE_SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase/)[1]
const TOKEN = env.SUPABASE_ACCESS_TOKEN
const S = env.VITE_ADMIN_PASSWORD
const q = (s) => `'${String(s).replace(/'/g, "''")}'`
async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const t = await r.text(); if (!r.ok) throw new Error(`SQL ${r.status}: ${t}`); return t ? JSON.parse(t) : []
}
const rpc = async (s) => (await sql(`select ${s} r`))[0].r
const won = (n) => '₩' + Number(n).toLocaleString('ko-KR')
let pass = 0, fail = 0
const check = (name, ok, extra = '') => { console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`); ok ? pass++ : fail++ }

const cash = (c) => sql(`select cash from teams where code=${q(c)}`).then((r) => Number(r[0].cash))
const equity = (c) => sql(`select team_equity(id) e from teams where code=${q(c)}`).then((r) => Number(r[0].e))
const price = (st) => sql(`select current_price(${q(st)}) p`).then((r) => Number(r[0].p))
async function buyFrac(code, stock, frac) {
  const [c, p] = await Promise.all([cash(code), price(stock)])
  if (p <= 0) return { ok: false, error: 'suspended(가격0)' }
  const qty = Math.max(1, Math.floor((c * frac) / p))
  return rpc(`place_order(${q(code)},${q(stock)},'buy',${qty})`)
}

async function main() {
  console.log('═══ 5라운드 풀 시뮬레이션 (새 데이터) ═══\n')
  await rpc(`reset_game(${q(S)})`)
  for (const c of ['SIM-1', 'SIM-2', 'SIM-3']) { await rpc(`admin_delete_team(${q(S)},${q(c)})`); await rpc(`admin_create_team(${q(S)},${q(c)},${q(c)},100000000)`) }

  for (let r = 1; r <= 5; r++) {
    const adv = await rpc(`advance_round(${q(S)})`)
    const g = (await sql(`select current_round, round_year_map->>current_round::text yr from game_state where id=1`))[0]
    console.log(`── R${g.current_round} (${g.yr}년)  자동힌트: ${JSON.stringify(adv.hints ?? {granted:0})}`)
    if (r >= 2) check(`R${r} 진입 시 힌트 자동 배분(>0)`, Number(adv.hints?.granted) > 0, `granted=${adv.hints?.granted}`)
    await rpc(`start_round_timer(${q(S)})`)

    if (r === 1) {
      // 신규상장 전(R1) M증권(S13) 매수 시도 → 거부돼야
      const s13 = await rpc(`place_order('SIM-1','S13','buy',1)`)
      check('R1 신규상장 전 M증권 매수 거부', !s13.ok, s13.error)
      await buyFrac('SIM-1', 'S02', 0.9) // 백만전자
      await buyFrac('SIM-2', 'S05', 0.9) // 양재금융 (R5에 상장폐지)
      await buyFrac('SIM-3', 'S06', 0.9) // F모빌리티 (최종 2025에 0)
    }
    if (r === 3) {
      const s13 = await buyFrac('SIM-1', 'S13', 0.3) // 이제 상장됨(1700)
      check('R3 상장 후 M증권 매수 성공', s13.ok === true, s13.error || 'ok')
    }
  }

  // R5 시점: 양재금융(S05) 상장폐지(2024 가격 0) → SIM-2 보유 평가액 0
  const s05now = await price('S05')
  const sim2holdVal = (await sql(`select coalesce(p.quantity,0)*current_price('S05') v from positions p join teams t on t.id=p.team_id where t.code='SIM-2' and p.stock_id='S05'`))[0]?.v
  check('R5 양재금융 거래정지(가격 0)', s05now === 0, `현재가 ${s05now}`)
  check('R5 폐지 종목 보유 평가액 0', Number(sim2holdVal ?? 0) === 0)

  // 대회 종료 → 2025 최종 정산
  const end = await rpc(`admin_end_game(${q(S)})`)
  const g = (await sql(`select current_round, total_rounds, is_ended, final_year from game_state where id=1`))[0]
  check('종료: is_ended', g.is_ended === true)
  check('종료: current_round = total+1', Number(g.current_round) === Number(g.total_rounds) + 1, `round=${g.current_round}`)
  const s06final = await price('S06')
  check('최종 정산 시 F모빌리티 2025 가격 0', s06final === 0, `end.final_year=${end.final_year}`)

  console.log('\n── 최종 순위 (2025 가격 기준) ──')
  const board = await sql(`select rank, name, equity, pnl_pct from leaderboard() order by rank`)
  for (const b of board) if (String(b.name).startsWith('SIM')) console.log(`  ${b.rank}위 ${b.name} · 평가 ${won(b.equity)} · ${Number(b.pnl_pct).toFixed(1)}%`)

  await rpc(`reset_game(${q(S)})`)
  for (const c of ['SIM-1', 'SIM-2', 'SIM-3']) await rpc(`admin_delete_team(${q(S)},${q(c)})`)
  console.log(`\n${fail === 0 ? '✅ 전부 통과' : '❌ 실패 ' + fail + '건'} (통과 ${pass}, 실패 ${fail}). 정리 완료.`)
  if (fail) process.exit(1)
}
main().catch((e) => { console.error('실패:', e.message); process.exit(1) })
