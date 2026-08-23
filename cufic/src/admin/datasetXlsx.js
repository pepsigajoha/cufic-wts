// 데이터셋 엑셀(.xlsx) 왕복 — 정본 양식(docs/CUFIC_WTS_데이터셋_제작양식.xlsx)와 1:1.
//   시트: 읽어주세요(안내) / 게임설정 / 종목 / 재무제표 / 힌트 / 시황
//   · 업로드: 파싱 → 검증(error=차단 / warning·info=허용) → payload(내보내기 JSON과 동일 구조)
//   · 지표 정의는 src/metrics.js 단일 소스를 참조(열 매핑도) — 지표가 바뀌면 파서가 함께 따라간다.
//   · 열 매핑은 위치가 아니라 헤더 이름(키워드)으로 → 열 순서·추가에 강함. 모르는 열은 info로 '무시됨'.
// SheetJS(xlsx)는 무거우므로 이 모듈은 AdminDatasets에서 동적 import 한다(학생 번들 미영향).
import * as XLSX from 'xlsx'
import { FIN_INPUTS, MACRO_METRICS, deriveFinancials } from '../metrics.js'

// 재무 시트 오른쪽 '※자동' 참조 열 — 엑셀 수식으로 자동 계산(입력 X, 파서는 무시). 정본 양식과 1:1.
// 열: A종목ID B연도 C유동자산 D비유동자산 E유동부채 F비유동부채 G매출 H영업비용 I영업외비용 → J~P 자동.
const FIN_AUTO = [
  { label: '자산합계 ※자동', f: (R) => `C${R}+D${R}`, v: (d) => d.assets },
  { label: '부채합계 ※자동', f: (R) => `E${R}+F${R}`, v: (d) => d.liabilities },
  { label: '자본 ※자동', f: (R) => `J${R}-K${R}`, v: (d) => d.equity },
  { label: '영업이익 ※자동', f: (R) => `G${R}-H${R}`, v: (d) => d.operatingIncome },
  { label: '당기순이익 ※자동', f: (R) => `M${R}-I${R}`, v: (d) => d.netIncome },
  { label: '부채비율(%) ※자동', f: (R) => `IF(L${R}<=0,"—",ROUND(K${R}/L${R}*100,1))`, v: (d) => (d.debtRatio == null ? '—' : Math.round(d.debtRatio * 10) / 10) },
  { label: 'ROE(%) ※자동', f: (R) => `IF(L${R}<=0,"—",ROUND(N${R}/L${R}*100,1))`, v: (d) => (d.roe == null ? '—' : Math.round(d.roe * 10) / 10) },
]

const GRADES = ['S', 'A', 'B', 'C', 'D']
const IMPACTS = ['up', 'down', 'flat']
const s = (v) => String(v ?? '').trim()
const isNum = (v) => v !== '' && v != null && !Number.isNaN(Number(v))
const isInt = (v) => isNum(v) && Number.isInteger(Number(v))
const won = (n) => Number(n).toLocaleString('en-US')

const rowsOf = (ws) => XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: true, raw: true })
function headerRow(rows, ...anchors) {
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].map((c) => s(c))
    const nonEmpty = cells.filter((c) => c !== '').length
    if (nonEmpty >= 3 && anchors.every((a) => cells.some((c) => c.includes(a)))) return i
  }
  return -1
}
function colOf(header, ...keys) {
  const cells = header.map((c) => s(c))
  for (let i = 0; i < cells.length; i++) for (const k of keys) if (cells[i].includes(k)) return i
  return -1
}
// 매핑된 열 인덱스 집합에 없는 헤더 셀 → '무시됨' info
function reportUnknown(header, mapped, sheet, kH, INFO) {
  header.forEach((c, idx) => {
    const name = s(c)
    if (name && !mapped.has(idx)) INFO(sheet, kH + 1, `'${name}' 열은 알 수 없어 무시됐어요`)
  })
}

/** @returns {{payload, errors[], warnings[], infos[]}} — 각 항목 {sheet,row,msg} */
export function parseWorkbook(buf) {
  const errors = [],
    warnings = [],
    infos = []
  const E = (sheet, row, msg) => errors.push({ sheet, row, msg })
  const W = (sheet, row, msg) => warnings.push({ sheet, row, msg })
  const INFO = (sheet, row, msg) => infos.push({ sheet, row, msg })
  let wb
  try {
    wb = XLSX.read(buf, { type: 'array' })
  } catch {
    return { payload: null, errors: [{ sheet: '파일', row: 0, msg: '엑셀 파일을 열 수 없어요' }], warnings: [], infos: [] }
  }
  for (const n of ['게임설정', '종목', '재무제표', '힌트', '시황'])
    if (!wb.SheetNames.includes(n)) E(n, 0, '시트가 없어요')
  if (errors.length) return { payload: null, errors, warnings, infos }

  // ── ① 게임설정
  const gRows = rowsOf(wb.Sheets['게임설정'])
  const gH = headerRow(gRows, '항목', '값')
  const game = { round_year_map: {} }
  if (gH < 0) E('게임설정', 0, '헤더(항목/값)를 못 찾았어요')
  else {
    for (let i = gH + 1; i < gRows.length; i++) {
      const k = s(gRows[i][0]),
        v = gRows[i][1]
      if (!k) continue
      if (k.includes('총 라운드')) game.total_rounds = Number(v)
      else if (k.includes('시드')) game.default_seed = Number(v)
      else if (k.includes('타이머')) game.round_duration_seconds = Number(v)
      else if (k.includes('최종')) game.final_year = Number(v)
      else {
        const m = k.match(/R\s*(\d+)\s*연도/)
        if (m && isInt(v)) game.round_year_map[Number(m[1])] = Number(v)
        else if (m) E('게임설정', i + 1, `${k} 값이 연도(정수)가 아니에요: "${v}"`)
      }
    }
    if (!isInt(game.total_rounds) || game.total_rounds < 1) E('게임설정', 0, '총 라운드 수가 올바르지 않아요')
    if (!isInt(game.default_seed)) E('게임설정', 0, '시작 시드머니(정수)가 필요해요')
    if (!isInt(game.final_year)) E('게임설정', 0, '최종 정산 연도(정수)가 필요해요')
    for (let r = 1; r <= (game.total_rounds || 0); r++)
      if (!isInt(game.round_year_map[r])) E('게임설정', 0, `R${r} 연도가 없어요`)
    game.round_duration_seconds = isInt(game.round_duration_seconds) ? Number(game.round_duration_seconds) : 600
  }
  const gameYears = new Set(Object.values(game.round_year_map).filter(Number.isFinite))
  if (isInt(game.final_year)) gameYears.add(Number(game.final_year))

  // ── ② 종목 (가격 칸: 숫자=가격 / %끝=전년 대비 등락률)
  const stocks = [],
    stockIds = new Set()
  const kRows = rowsOf(wb.Sheets['종목'])
  const kH = headerRow(kRows, 'ID', '종목명')
  if (kH < 0) E('종목', 0, '헤더(ID/종목명)를 못 찾았어요')
  else {
    const H = kRows[kH]
    const ci = { id: colOf(H, 'ID'), name: colOf(H, '종목명'), sector: colOf(H, '업종'), desc: colOf(H, '소개'), listed: colOf(H, '상장') }
    const priceCols = []
    H.forEach((c, idx) => {
      const m = s(c).match(/(\d{4}).*가격/)
      if (m) priceCols.push({ col: idx, year: Number(m[1]) })
    })
    priceCols.sort((a, b) => a.year - b.year)
    const priceYears = new Set(priceCols.map((p) => p.year))
    for (const y of gameYears) if (!priceYears.has(y)) E('종목', kH + 1, `가격 열에 ${y}년이 없어요 (게임 연도와 불일치)`)
    for (const p of priceCols) if (!gameYears.has(p.year)) W('종목', kH + 1, `${p.year}년 가격 열은 게임에 없는 연도예요(무시됨)`)
    const mapped = new Set([ci.id, ci.name, ci.sector, ci.desc, ci.listed, ...priceCols.map((p) => p.col)].filter((x) => x >= 0))
    reportUnknown(H, mapped, '종목', kH, INFO)

    for (let i = kH + 1; i < kRows.length; i++) {
      const row = kRows[i],
        ex = i + 1
      const id = s(row[ci.id])
      if (!id && !s(row[ci.name])) continue
      if (!id) {
        E('종목', ex, 'ID가 비었어요')
        continue
      }
      if (stockIds.has(id)) {
        E('종목', ex, `ID가 중복돼요: ${id}`)
        continue
      }
      if (!s(row[ci.name])) E('종목', ex, `종목명이 비었어요 (ID ${id})`)
      // 가격: 연도 오름차순으로 훑으며 %는 전년 대비 환산
      const prices = {}
      let prevPrice = null
      for (const { col, year } of priceCols) {
        if (!gameYears.has(year)) continue
        const cell = s(row[col])
        if (cell === '') {
          prevPrice = null
          continue
        } // 빈칸 = 거래정지·미상장
        if (/%\s*$/.test(cell)) {
          const pct = parseFloat(cell.replace(/[%+\s]/g, ''))
          if (Number.isNaN(pct)) {
            E('종목', ex, `${year}년 등락률이 숫자가 아니에요: "${cell}"`)
            prevPrice = null
            continue
          }
          if (prevPrice == null || prevPrice <= 0) {
            E('종목', ex, `${year}년에 %(${cell})를 썼는데 전년 가격이 없어요 — 첫 등장 연도는 가격(원)으로 넣어주세요`)
            prevPrice = null
            continue
          }
          const p = Math.round(prevPrice * (1 + pct / 100))
          if (p > 0) prices[year] = p
          INFO('종목', ex, `${id} ${year}: ${cell} → ${won(p)}원`)
          prevPrice = p
        } else {
          if (!isNum(cell)) {
            E('종목', ex, `${year}년 가격이 숫자가 아니에요: "${cell}"`)
            prevPrice = null
            continue
          }
          const p = Math.round(Number(cell))
          if (p > 0) prices[year] = p
          prevPrice = p
        }
      }
      stockIds.add(id)
      stocks.push({
        id,
        name: s(row[ci.name]),
        sector: ci.sector >= 0 ? s(row[ci.sector]) : '', // 업종은 선택
        description: s(row[ci.desc]),
        listed_from_round: isInt(row[ci.listed]) ? Number(row[ci.listed]) : 1,
        prices,
        display_order: stocks.length,
      })
    }
    if (!stocks.length) E('종목', 0, '종목이 최소 1개는 필요해요')
  }

  // ── ③ 재무제표 (열은 metrics 설정에서)
  const financials = []
  const fRows = rowsOf(wb.Sheets['재무제표'])
  const fH = headerRow(fRows, '종목ID')
  if (fH < 0) E('재무제표', 0, '헤더(종목ID)를 못 찾았어요')
  else {
    const H = fRows[fH]
    const sidC = colOf(H, '종목ID'),
      yearC = colOf(H, '연도')
    const metCols = FIN_INPUTS.map((m) => ({ m, col: colOf(H, ...[].concat(m.xlsx)) }))
    reportUnknown(H, new Set([sidC, yearC, ...metCols.map((x) => x.col)].filter((x) => x >= 0)), '재무제표', fH, INFO)
    for (let i = fH + 1; i < fRows.length; i++) {
      const row = fRows[i],
        ex = i + 1
      const sid = s(row[sidC])
      if (!sid) continue
      if (!stockIds.has(sid)) E('재무제표', ex, `종목ID가 종목 시트에 없어요: ${sid}`)
      if (!isInt(row[yearC])) {
        E('재무제표', ex, `연도가 정수가 아니에요: "${row[yearC]}"`)
        continue
      }
      const rec = { stock_id: sid, year: Number(row[yearC]) }
      for (const { m, col } of metCols) {
        const v = col >= 0 ? row[col] : ''
        if (v !== '' && !isNum(v)) E('재무제표', ex, `${m.label}가 숫자가 아니에요: "${v}"`)
        rec[m.db] = m.unit === '억원' ? Math.round(Number(v) || 0) : Number(v) || 0
      }
      financials.push(rec)
    }
  }

  // ── ⑤ 시황 (열은 metrics 설정에서)
  const macro = []
  const mRows = rowsOf(wb.Sheets['시황'])
  const mH = headerRow(mRows, '연도', '요약')
  if (mH < 0) E('시황', 0, '헤더(연도/요약)를 못 찾았어요')
  else {
    const H = mRows[mH]
    const yearC = colOf(H, '연도'),
      sumC = colOf(H, '요약')
    const metCols = MACRO_METRICS.map((m) => ({ m, col: colOf(H, ...[].concat(m.xlsx)) }))
    reportUnknown(H, new Set([yearC, sumC, ...metCols.map((x) => x.col)].filter((x) => x >= 0)), '시황', mH, INFO)
    for (let i = mH + 1; i < mRows.length; i++) {
      const row = mRows[i],
        ex = i + 1
      if (!isInt(row[yearC])) {
        if (s(row[sumC])) E('시황', ex, `연도가 정수가 아니에요: "${row[yearC]}"`)
        continue
      }
      const rec = { year: Number(row[yearC]), summary: s(row[sumC]) }
      for (const { m, col } of metCols) {
        const v = col >= 0 ? row[col] : ''
        if (v !== '' && !isNum(v)) E('시황', ex, `${m.label}가 숫자가 아니에요: "${v}"`)
        rec[m.key] = m.round ? Math.round(Number(v) || 0) : Number(v) || 0
      }
      macro.push(rec)
    }
  }

  // ── ④ 힌트 (방향·관련종목은 선택)
  const hints = []
  const hRows = rowsOf(wb.Sheets['힌트'])
  const hH = headerRow(hRows, '라운드', '등급')
  if (hH < 0) E('힌트', 0, '헤더(라운드/등급)를 못 찾았어요')
  else {
    const H = hRows[hH]
    const ci = { round: colOf(H, '라운드'), grade: colOf(H, '등급'), head: colOf(H, '문구'), dir: colOf(H, '방향'), rel: colOf(H, '관련') }
    reportUnknown(H, new Set([ci.round, ci.grade, ci.head, ci.dir, ci.rel].filter((x) => x >= 0)), '힌트', hH, INFO)
    for (let i = hH + 1; i < hRows.length; i++) {
      const row = hRows[i],
        ex = i + 1
      if (!isInt(row[ci.round]) && !s(row[ci.head])) continue
      if (!isInt(row[ci.round])) {
        E('힌트', ex, `라운드가 정수가 아니에요: "${row[ci.round]}"`)
        continue
      }
      const grade = s(row[ci.grade]).toUpperCase()
      if (!GRADES.includes(grade)) E('힌트', ex, `등급은 S/A/B/C/D만 돼요: "${row[ci.grade]}"`)
      if (!s(row[ci.head])) E('힌트', ex, '힌트 문구가 비었어요')
      // 방향(선택): 비면 flat. 있으면 up/down/flat만.
      const dirRaw = ci.dir >= 0 ? s(row[ci.dir]).toLowerCase() : ''
      let impact = 'flat'
      if (dirRaw !== '') {
        if (!IMPACTS.includes(dirRaw)) E('힌트', ex, `방향은 up/down/flat만 돼요(비워도 됨): "${row[ci.dir]}"`)
        else impact = dirRaw
      }
      // 관련종목(선택)
      const rel =
        ci.rel >= 0
          ? s(row[ci.rel])
              .split(/[,\s;]+/)
              .map((x) => x.trim())
              .filter(Boolean)
          : []
      rel.forEach((id) => {
        if (!stockIds.has(id)) E('힌트', ex, `관련 종목ID가 종목 시트에 없어요: ${id}`)
      })
      hints.push({ round: Number(row[ci.round]), grade, headline: s(row[ci.head]), impact, related_stock_ids: rel, __row: ex })
    }
  }

  // ── 교차 검증(에러 없을 때만)
  if (!errors.length) {
    const priceOf = (id, y) => stocks.find((x) => x.id === id)?.prices[y]
    for (const h of hints) {
      // 방향·관련종목이 비면 등락 검증 스킵을 info로 표시
      if (h.impact === 'flat' || h.related_stock_ids.length === 0) {
        INFO('힌트', h.__row, `R${h.round} ${h.grade}: 방향/관련종목이 없어 등락 검증을 건너뛰었어요`)
        continue
      }
      const cur = game.round_year_map[h.round]
      const nxt = game.round_year_map[h.round + 1] ?? game.final_year
      for (const id of h.related_stock_ids) {
        const p0 = priceOf(id, cur),
          p1 = priceOf(id, nxt)
        if (p0 == null || p1 == null) continue
        if (h.impact === 'up' && !(p1 > p0)) W('힌트', h.__row, `방향 up인데 ${id} ${cur}→${nxt} 가격이 안 올라요 (호재↔등락 불일치)`)
        if (h.impact === 'down' && !(p1 < p0)) W('힌트', h.__row, `방향 down인데 ${id} ${cur}→${nxt} 가격이 안 내려요 (악재↔등락 불일치)`)
      }
    }
    for (let r = 2; r <= (game.total_rounds || 0); r++)
      for (const g of GRADES)
        if (!hints.some((h) => h.round === r && h.grade === g))
          W('힌트', 0, `R${r} ${g}등급 힌트가 없어요 (자동배분 때 인접 등급으로 대체돼요)`)
  }
  hints.forEach((h) => delete h.__row)

  const payload = errors.length
    ? null
    : {
        game: {
          total_rounds: game.total_rounds,
          round_year_map: game.round_year_map,
          default_seed: game.default_seed,
          final_year: game.final_year,
          round_duration_seconds: game.round_duration_seconds,
        },
        stocks,
        financials,
        macro,
        hints,
      }
  return { payload, errors, warnings, infos }
}

/** payload → 같은 양식(v3)의 .xlsx (Uint8Array). 가격은 절대값(원)으로 내보낸다. */
export function buildWorkbook(payload) {
  const { game, stocks, financials, macro, hints } = payload
  const years = [...new Set([...Object.values(game.round_year_map || {}).map(Number), Number(game.final_year)])]
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
  const roundNums = Object.keys(game.round_year_map || {})
    .map(Number)
    .sort((a, b) => a - b)
  const aoa = (rows) => XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()

  XLSX.utils.book_append_sheet(
    wb,
    aoa([
      ['CUFIC WTS 게임 데이터셋 제작 양식 (v4)'],
      [''],
      ['이 파일의 시트 5개(게임설정·종목·재무제표·힌트·시황)를 채우면 게임 한 판이 완성됩니다.'],
      ['헤더에 "(선택)"이 붙은 칸만 비워도 되고, 나머지는 필수예요. (공식 정본 파일에는 필수=노랑·선택=파랑으로 색칠돼 있어요.)'],
      ['지금 들어있는 내용은 예시입니다 — 지우지 말고 고쳐 쓰는 걸 추천해요.'],
      ['종목·힌트 개수는 자유입니다. 행을 추가/삭제하면 그대로 게임 구성이 돼요. (힌트는 라운드당 등급별 1개 이상 권장)'],
      [''],
      ['★ 가격은 두 가지 방법으로 쓸 수 있어요 (②종목 시트)'],
      ['  · 그냥 숫자 = 가격(원)  (예: 7300)'],
      ['  · %를 붙이면 = 전년 대비 등락률 → 업로드할 때 자동으로 가격으로 계산돼요  (예: +80%, -25%)'],
      ['  · 단, 종목이 처음 등장하는 연도는 반드시 가격(숫자)으로! (기준점이 필요해요)'],
      ['  · 섞어 써도 됩니다: 2020=7300, 2021=+80%, 2022=17700 처럼'],
      [''],
      ['작성 순서 (이 순서대로!)'],
      ['  ① 게임설정 — 라운드 수·연도·시드 확정'],
      ['  ② 종목 — 이름·소개와 연도별 가격 (게임의 뼈대. 가격을 먼저 완성해야 힌트를 맞출 수 있어요)'],
      ['  ③ 재무제표 — 입력 잎 7개(유동자산·비유동자산·유동부채·비유동부채·매출·영업비용·영업외비용)만. 자산·부채·자본·이익·부채비율·ROE는 자동 계산'],
      ['  ④ 힌트 — 라운드×등급별. ★제일 중요: R라운드 힌트는 "그 해 → 다음 해" 변동의 예고예요'],
      ['  ⑤ 시황 — 연도별 거시 지표 (실제 역사 기반이면 사실에 가깝게)'],
      [''],
      ['꼭 지킬 규칙'],
      ['  · 가격 0 또는 빈칸 = 거래정지/상장폐지로 동작 (의도할 때만!) — 0인 해 다음에는 %를 쓸 수 없어요'],
      ['  · 신규상장 종목은 상장 전 연도 가격을 비워두세요'],
      ['  · 재무는 입력 7개(억원)만 넣고 음수는 쓰지 마세요 — 적자는 영업비용>매출로 표현돼요'],
      ['  · 힌트의 "방향·관련 종목"은 선택이지만, 채우면 업로드 때 문구↔실제 등락 모순을 자동으로 잡아줘요'],
      ['  · 다 채우면 관리자 [데이터셋] 탭 → [📊 엑셀 업로드] → 자동 검증 → 새 데이터셋 완성'],
    ]),
    '읽어주세요',
  )

  const gRows = [
    ['① 게임설정', '', ''],
    ['항목 이름(A열)은 그대로 두고 값(B열)만 수정하세요. 라운드 연도는 ②종목 시트 가격 열과 일치해야 해요.', '', ''],
    ['항목', '값', '설명'],
    ['총 라운드 수', game.total_rounds, '보통 5'],
    ['시작 시드머니(원)', game.default_seed, '전 조 동일'],
    ['타이머(초)', game.round_duration_seconds ?? 600, '600 = 10분'],
    ['최종 정산 연도', game.final_year, '대회 종료 시 이 연도 가격으로 최종 평가'],
  ]
  roundNums.forEach((r) => gRows.push([`R${r} 연도`, game.round_year_map[r], `${r}라운드에서 거래하는 연도`]))
  XLSX.utils.book_append_sheet(wb, aoa(gRows), '게임설정')

  const kHead = ['ID', '종목명', '한 줄 소개', '업종 (선택)', '상장라운드', ...years.map((y) => `${y}년 가격`)]
  const kRows = [
    ['② 종목과 연도별 가격', ...Array(kHead.length - 1).fill('')],
    ['한 행 = 종목 하나. 가격 칸: 숫자=가격(원), %붙이면=전년 대비 등락률(예: +80%). 첫 등장 연도는 반드시 가격! 빈칸/0 = 거래정지·미상장.', ...Array(kHead.length - 1).fill('')],
    kHead,
  ]
  stocks
    .slice()
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
    .forEach((st) => kRows.push([st.id, st.name, st.description || '', st.sector || '', st.listed_from_round ?? 1, ...years.map((y) => st.prices?.[y] ?? '')]))
  XLSX.utils.book_append_sheet(wb, aoa(kRows), '종목')

  const fHead = ['종목ID', '연도', ...FIN_INPUTS.map((m) => `${m.label}(억)`), ...FIN_AUTO.map((a) => a.label)]
  const fRows = [
    ['③ 재무제표 (종목 × 연도)', ...Array(fHead.length - 1).fill('')],
    ['입력은 잎 7개(억원)만! 오른쪽 ※자동 열(자산합계·자본·부채비율·ROE 등)은 엑셀이 자동 계산 — 참고용이니 채우지 마세요. 미상장·폐지 연도는 행을 빼세요.', ...Array(fHead.length - 1).fill('')],
    fHead,
  ]
  financials.forEach((f) => fRows.push([f.stock_id, f.year, ...FIN_INPUTS.map((m) => f[m.db]), ...Array(FIN_AUTO.length).fill(null)]))
  const fWs = aoa(fRows)
  // ※자동 열(J~P)에 엑셀 수식 + 캐시값. 데이터 첫 엑셀 행 = 4 (제목·설명·헤더가 1·2·3행).
  financials.forEach((f, i) => {
    const R = 4 + i
    const d = deriveFinancials(Object.fromEntries(FIN_INPUTS.map((m) => [m.key, Number(f[m.db]) || 0])))
    FIN_AUTO.forEach((a, j) => {
      const v = a.v(d)
      fWs[XLSX.utils.encode_col(9 + j) + R] = typeof v === 'number' ? { t: 'n', f: a.f(R), v } : { t: 'str', f: a.f(R), v }
    })
  })
  XLSX.utils.book_append_sheet(wb, fWs, '재무제표')

  const hHead = ['라운드', '등급(S~D)', '힌트 문구', '방향(up/down/flat) (선택)', '관련 종목ID (선택)']
  const hRows = [
    ['④ 힌트 (라운드 × 등급)', '', '', '', ''],
    ['R1은 지급 없음. 방향·관련종목은 선택(채우면 자동 검증·종목 링크 작동, 학생에겐 방향 안 보임). 관련종목은 쉼표로.', '', '', '', ''],
    hHead,
  ]
  hints.forEach((h) => hRows.push([h.round, h.grade, h.headline, h.impact === 'flat' ? '' : h.impact, (h.related_stock_ids || []).join(',')]))
  XLSX.utils.book_append_sheet(wb, aoa(hRows), '힌트')

  const mHead = ['연도', '한 줄 요약', ...MACRO_METRICS.map((m) => `${m.label}(${m.unit})`)]
  const mRows = [
    ['⑤ 시황 (연도별 거시경제)', ...Array(mHead.length - 1).fill('')],
    ['한 행 = 한 해. 한 줄 요약은 학생 시황판 맨 위에 크게 보여요.', ...Array(mHead.length - 1).fill('')],
    mHead,
  ]
  macro.forEach((m) => mRows.push([m.year, m.summary, ...MACRO_METRICS.map((mm) => m[mm.key])]))
  XLSX.utils.book_append_sheet(wb, aoa(mRows), '시황')

  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
}

// 빈 양식(.xlsx) — 헤더 + 형식을 보여주는 예시 2줄만. 나머지는 직접 채운다.
export function buildBlankWorkbook() {
  const example = {
    game: {
      total_rounds: 5,
      round_year_map: { 1: 2020, 2: 2021, 3: 2022, 4: 2023, 5: 2024 },
      default_seed: 100000000,
      final_year: 2025,
      round_duration_seconds: 600,
    },
    stocks: [
      { id: 'S01', name: '한빛반도체', sector: '', description: '반도체를 만드는 회사예요', listed_from_round: 1, prices: { 2020: 10000, 2021: 12000, 2022: 9000, 2023: 15000, 2024: 18000, 2025: 20000 }, display_order: 0 },
      { id: 'S02', name: '미래바이오', sector: '', description: '신약을 개발하는 바이오 회사예요 (R3 상장 예시)', listed_from_round: 3, prices: { 2022: 5000, 2023: 8000, 2024: 12000, 2025: 15000 }, display_order: 1 },
    ],
    financials: [
      { stock_id: 'S01', year: 2020, current_assets: 6000, noncurrent_assets: 4000, current_liabilities: 2000, noncurrent_liabilities: 1000, revenue: 5000, operating_expense: 4200, nonoperating_expense: 200 },
      { stock_id: 'S01', year: 2021, current_assets: 7000, noncurrent_assets: 5000, current_liabilities: 2500, noncurrent_liabilities: 1500, revenue: 7000, operating_expense: 5800, nonoperating_expense: 300 },
    ],
    macro: [
      { year: 2020, summary: '코로나 충격으로 경기 급랭 (예시)', kospi: 2300, sp500: 3100, nikkei: 23000, europe: 3300, rate: 0.5, cpi: 0.5, oil: 42, gold: 1900 },
      { year: 2021, summary: '경기 반등·유동성 장세 (예시)', kospi: 3200, sp500: 4300, nikkei: 28000, europe: 4300, rate: 0.75, cpi: 2.5, oil: 68, gold: 1800 },
    ],
    hints: [
      { round: 2, grade: 'S', headline: '반도체 재고 급증… 업황 둔화 우려 (예시)', impact: 'down', related_stock_ids: ['S01'] },
      { round: 2, grade: 'D', headline: '방향·관련종목은 비워도 돼요 (예시)', impact: 'flat', related_stock_ids: [] },
    ],
  }
  return buildWorkbook(example)
}
