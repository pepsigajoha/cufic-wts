// 표준 옵션 자동상장(auto_list_round_options) + 구조화 상품 발행(issue_structured_product)을
// dev DB에서 검증한다. 게임을 reset하고 다시 raise하므로 대회 중에는 실행하지 말 것.
// 실행: node scripts/verify-auto-listing.mjs
import { readFileSync } from 'node:fs'

const DEV_REF = 'dqvcagrbkvhnetqydgnk'
const ENV_PATH = 'C:/Users/jungj/OneDrive/바탕 화면/M1-Harry/stock_maker - 복사본 - 복사본/cufic/.env'
const env = Object.fromEntries(
  readFileSync(ENV_PATH, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }),
)
const TOKEN = env.SUPABASE_ACCESS_TOKEN
const ADMIN_PW = env.VITE_ADMIN_PASSWORD
const q = (s) => `'${String(s).replace(/'/g, "''")}'`

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${DEV_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const t = await r.text()
  if (!r.ok) throw new Error(`SQL ${r.status}: ${t}`)
  return t ? JSON.parse(t) : []
}
const rpc = async (s) => (await sql(`select ${s} r`))[0].r
const scalar = async (expr) => (await sql(`select ${expr} v`))[0].v

let pass = 0, fail = 0
function check(name, ok, detail = '') {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
  ok ? pass++ : fail++
}

async function main() {
  console.log(`대상: ${DEV_REF}\n`)
  await sql(`select reset_game(${q(ADMIN_PW)})`)

  // 상장 예정(listed_from_round > 그 라운드) 종목은 auto_list_round_options도 제외한다 —
  // 기대값도 라운드마다 같은 기준으로 다시 세야 한다(하드코딩한 종목수로 비교하면 안 됨).
  const eligibleAt = async (round) =>
    Number(await scalar(`(select count(*) from stocks where coalesce((prices->>'2020')::numeric,0) > 0 and listed_from_round <= ${round})`))

  console.log('=== [a] 라운드1 오픈 → 자동상장 ===')
  await sql(`select advance_round(${q(ADMIN_PW)})`)
  const n1 = await eligibleAt(1)
  const r1 = await sql(`select stock_id, option_type, strike, expiry_round, implied_vol, risk_free_rate, created_round from options_contracts order by stock_id, option_type`)
  check(`풋+콜 = R1 상장대상×2 (${n1 * 2}건) 생성됨`, r1.length === n1 * 2, `실제 ${r1.length}건`)

  const s01 = r1.filter((c) => c.stock_id === 'S01')
  const s01Price = Number(await scalar(`current_price('S01')`))
  check('S01 계약의 행사가 = 현재 공식가(등가격)', s01.every((c) => Number(c.strike) === s01Price), `strike=${s01[0]?.strike}, price=${s01Price}`)
  check('만기 라운드 = 2 (다음 라운드)', s01.every((c) => c.expiry_round === 2), `expiry=${s01[0]?.expiry_round}`)
  check('기본 변동성 0.25 적용', s01.every((c) => Number(c.implied_vol) === 0.25), `vol=${s01[0]?.implied_vol}`)
  check('무위험금리 0.03 적용', s01.every((c) => Number(c.risk_free_rate) === 0.03), `rate=${s01[0]?.risk_free_rate}`)
  check('풋/콜 둘 다 생성', s01.some((c) => c.option_type === 'put') && s01.some((c) => c.option_type === 'call'))

  console.log('\n=== [b] 방금 상장된 계약을 즉시 매수할 수 있는가(expiry_round > current_round) ===')
  await sql(`select start_round_timer(${q(ADMIN_PW)})`)
  const putContract = s01.find((c) => c.option_type === 'put')
  const contractRow = (await sql(`select id from options_contracts where stock_id='S01' and option_type='put' and expiry_round=2 limit 1`))[0]
  const order = await rpc(`place_option_order('TEST-01', ${contractRow.id}, 1)`)
  check('자동상장 계약 매수 성공', order.ok === true, JSON.stringify(order))

  console.log('\n=== [c] 라운드2 오픈 → R1 계약 자동 정산 + R2용 새 계약 상장 ===')
  await sql(`select advance_round(${q(ADMIN_PW)})`)
  const pos = (await sql(`select status, settled_payoff from user_options_positions where team_id=(select id from teams where code='TEST-01') order by id desc limit 1`))[0]
  check('R2 도달 시 R1에서 산 계약이 자동 정산됨', pos.status !== 'open', `status=${pos.status}`)

  const n2 = await eligibleAt(2)
  const r2Count = Number(await scalar(`(select count(*) from options_contracts where created_round = 2)`))
  check(`R2용 계약도 새로 상장됨 (${n2 * 2}건)`, r2Count === n2 * 2, `실제 ${r2Count}건`)

  const r1StillThere = Number(await scalar(`(select count(*) from options_contracts where created_round = 1)`))
  check('R1 계약은 삭제되지 않고 남아있음(만기 지난 채로, 이력용)', r1StillThere === n1 * 2, `실제 ${r1StillThere}건`)

  console.log('\n=== [d] 구조화 상품(ELS) 발행 (TIGER-03, 잔고 넉넉한 팀) ===')
  const cashBefore = Number((await sql(`select cash from teams where code='TIGER-03'`))[0].cash)
  const issue = await rpc(`issue_structured_product('TIGER-03', 'S02', 10000, 80, 8, 5000000)`)
  check('발행 성공', issue.ok === true, JSON.stringify(issue))
  const cashAfter = Number((await sql(`select cash from teams where code='TIGER-03'`))[0].cash)
  check('발행 금액만큼 현금이 담보로 차감됨', cashBefore - cashAfter === 5000000, `차이=${cashBefore - cashAfter}`)

  const overIssue = await rpc(`issue_structured_product('TIGER-03', 'S02', 10000, 80, 8, 999999999999)`)
  check('현금보다 큰 발행금액은 거부됨', overIssue.ok === false && overIssue.error === 'insufficient_cash', JSON.stringify(overIssue))

  console.log('\n=== [e] 뒷정리 ===')
  await sql(`select reset_game(${q(ADMIN_PW)})`)
  console.log('  reset_game 완료')

  console.log(`\n=== 결과 요약: 통과 ${pass} / 실패 ${fail} / 총 ${pass + fail} ===`)
  if (fail > 0) process.exitCode = 1
}

main().catch((e) => { console.error('예외:', e.message); process.exit(1) })
