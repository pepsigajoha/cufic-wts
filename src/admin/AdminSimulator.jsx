import { useEffect, useMemo, useRef, useState } from 'react'
import Modal from '../components/Modal'
import { errorText } from '../supabase'
import { num, pct, dirOf } from '../format'
import { generatePriceSeries, simulateNextRound, defaultMacro } from './priceSim'
import { classifySector, buildSectorPalette } from './sectorTaxonomy'
import { PRESETS, QUARTER_PRESETS, deriveSectorBetas } from './simulatorPresets'
import { MACRO_FIELDS } from './macroFields'
import { defaultQuarterConfigs, isValidQuarterConfigs, normalizeQuarterConfigs } from './quarterConfig'
import Segmented from './Segmented'
import { MACRO_DIALS, activeLevelId, quarterMood } from './macroLevels'
import { generateMacroNews } from './macroNews'
import { generateBreakingNews } from './newsService'
import { refineHintHeadlines } from './hintService'
import { getGeminiKey, setGeminiKey, clearGeminiKey, hasGeminiKey, getGeminiModel, setGeminiModel } from './gemini'
import { buildDerivedContent } from './simContent'
import PreviewChart from './PreviewChart'

// 슬라이더/시드/모드를 세션 동안 기억한다 — AdminSimulator는 탭을 벗어나면 언마운트돼
// useState만으로는 값이 다 날아간다(Admin.jsx의 admin secret과 같은 이유로 sessionStorage 사용).
const STORAGE_KEY = 'wts-admin-simulator-state'
function loadPersisted() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

// 여러 속보 후보를 한 세트(제목 1개 + 본문 1개)로 합친다. broadcasts 테이블이 한 줄짜리
// headline 컬럼 하나뿐이라(별도 body 컬럼 없음), 실제 발행 시엔 이 둘을 합쳐서 보낸다.
function composeNews(items) {
  if (items.length === 1) return { headline: items[0].headline, body: items[0].body }
  return {
    headline: items.map((it) => it.headline).join(' · '),
    body: items.map((it, i) => `[${i + 1}] ${it.headline}\n${it.body}`).join('\n\n'),
  }
}

// 스토리 프리셋 한 줄 설명 (QUARTER_PRESETS의 key로)
const PRESET_DESC = {
  'steady-growth': '분기마다 조금씩 우상향',
  'q2-crisis-q4-rebound': '2분기 급락 → 4분기 반등',
  'box-range': '오르락내리락, 제자리',
  'slow-bear': '분기 갈수록 서서히 하락',
}

// "한 흐름" 모드의 손잡이를 한 질문씩 묻는 문장 (Toss식 설문). MACRO_DIALS.key 기준.
const DIAL_Q = {
  cycle: '이번 라운드, 경기는 어때요?',
  rates: '금리와 물가는요?',
  external: '환율·유가 같은 대외 여건은요?',
}

/** 프리셋/현재 4분기의 대략 모양(GDP 기준)을 미니 라인으로. */
function QuarterSpark({ quarters, stroke = 'var(--gold)' }) {
  const g = quarters.map((q) => Number(q?.macro?.gdp ?? 3))
  const lo = Math.min(...g, -2)
  const hi = Math.max(...g, 7)
  const y = (v) => 17 - ((v - lo) / (hi - lo || 1)) * 15
  const pts = g.map((v, i) => `${2 + i * 18},${y(v).toFixed(1)}`).join(' ')
  return (
    <svg width="60" height="20" viewBox="0 0 60 20" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

/** 주가 생성기 탭. 7요인 확률과정 엔진으로 라운드별 가격을 생성해 미리보고, 확인 후에만 반영한다. */
export default function AdminSimulator({
  actions,
  game,
  stocks,
  financials = [],
  macro: macroRows = [],
  refresh,
  notify,
}) {
  // 종목·가격 탭과 동일한 연도 산출 로직(라운드 연도 + 최종 정산 연도, 유령 열 없음)
  const finalYear = Number(game?.final_year) || null
  const years = useMemo(() => {
    const set = new Set(Object.values(game?.round_year_map ?? {}).map(Number).filter(Boolean))
    if (finalYear) set.add(finalYear)
    return [...set].sort((a, b) => a - b)
  }, [game, finalYear])
  const stockIds = useMemo(() => stocks.map((s) => s.id), [stocks])

  const sectors = useMemo(() => [...new Set(stocks.map(classifySector))], [stocks])
  const sectorColor = useMemo(() => buildSectorPalette(sectors), [sectors])
  const colorFor = (stock) => sectorColor[classifySector(stock)] ?? '#6b7280'

  const currentRound = game?.current_round ?? 0
  const totalRounds = game?.total_rounds ?? 0

  const [mode, setMode] = useState(() => (loadPersisted().mode === 'next' ? 'next' : 'batch'))
  const [macro, setMacro] = useState(() => ({ ...defaultMacro(), ...loadPersisted().macro }))
  const [seed, setSeed] = useState(() => {
    const s = loadPersisted().seed
    return Number.isFinite(s) ? s : 42
  })
  // 분기별(63일) 파라미터 — 켜면 매 연도 4분기 경계에서 거시 7요인을 통째로 교체한다. 기본 off(기존 동작 유지).
  const [useQuarters, setUseQuarters] = useState(() => loadPersisted().useQuarters === true)
  const [quarters, setQuarters] = useState(() => {
    const q = loadPersisted().quarters
    return isValidQuarterConfigs(q) ? q : defaultQuarterConfigs()
  })
  const [qSel, setQSel] = useState(0) // 지금 편집 중인 분기(0..3)
  // "한 흐름" 설문 진행 단계. 0..N-1 = 질문 중, >=N = 요약 화면.
  // 이미 알려진 레벨에 다 맞아떨어지면(재방문) 요약부터, 아니면 첫 질문부터.
  const [wizStep, setWizStep] = useState(() => {
    const m = { ...defaultMacro(), ...loadPersisted().macro }
    return MACRO_DIALS.every((d) => activeLevelId(d, m)) ? MACRO_DIALS.length : 0
  })
  const [preview, setPreview] = useState(null) // { prices, applyPrices, displayYears, forecastYears, betaFx, betaOil }
  const [visible, setVisible] = useState(() => new Set(stockIds))
  const [busy, setBusy] = useState(false)
  const [confirmApply, setConfirmApply] = useState(false)
  const [confirmApplyNews, setConfirmApplyNews] = useState(false)

  const [prevMacro, setPrevMacro] = useState(null) // 직전 "다음 라운드" 생성에 쓴 매크로(속보 델타용)
  const [newsHeadline, setNewsHeadline] = useState('')
  const [newsBody, setNewsBody] = useState('')
  const [newsSectors, setNewsSectors] = useState([])
  const [newsSource, setNewsSource] = useState(null) // 'rule' | 'gemini' | null
  const [aiBusy, setAiBusy] = useState(false)
  const [hintAiBusy, setHintAiBusy] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [keySet, setKeySet] = useState(() => hasGeminiKey())
  const [modelInput, setModelInput] = useState(() => getGeminiModel())
  // "다음 라운드만" 모드가 만들 라운드 포인터. 대회 진행 라운드와 독립 — 시작 전(R0)에도
  // R1→R2, R2→R3 … 를 한 칸씩 미리 만들 수 있게 한다.
  const [genRoundRaw, setGenRound] = useState(() => Math.max(game?.current_round ?? 0, 1))

  // advance_round/round_year_map과 같은 규칙. genRound = [1, 마지막 라운드]로 죈다.
  const genRound = Math.min(Math.max(genRoundRaw, 1), Math.max(totalRounds, 1))
  const currentRoundYear = game?.round_year_map?.[String(genRound)] ?? null
  const nextRoundNumber = genRound + 1
  const nextRoundYear =
    game?.round_year_map?.[String(nextRoundNumber)] ??
    (nextRoundNumber > totalRounds ? (game?.final_year ?? null) : null)
  const nextReady = !!currentRoundYear && !!nextRoundYear && stockIds.length > 0

  const namesById = useMemo(() => Object.fromEntries(stocks.map((s) => [s.id, s.name])), [stocks])
  // 이번 라운드 종목별 등락률(%) — 시황 프롬프트에 넘겨 문장이 실제 움직임을 설명하게 한다.
  const previewMoves = () => {
    if (!preview || mode !== 'next') return []
    const a = String(currentRoundYear)
    const b = String(nextRoundYear)
    return stockIds
      .map((id) => {
        const pa = Number(preview.prices[id]?.[a])
        const pb = Number(preview.prices[id]?.[b])
        if (!(pa > 0) || pb == null) return null
        return { name: namesById[id] ?? id, pct: ((pb - pa) / pa) * 100 }
      })
      .filter(Boolean)
  }

  const saveKey = () => {
    setGeminiKey(keyInput)
    setKeySet(hasGeminiKey())
    setKeyInput('')
  }
  const removeKey = () => {
    clearGeminiKey()
    setKeySet(false)
  }
  const saveModel = () => {
    setGeminiModel(modelInput)
    setModelInput(getGeminiModel())
  }

  // 탭을 벗어났다 돌아와도 슬라이더 값이 그대로이도록 바뀔 때마다 저장한다.
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ macro, seed, mode, useQuarters, quarters }))
    } catch {
      /* 무시 */
    }
  }, [macro, seed, mode, useQuarters, quarters])

  const setField = (key, v) => setMacro((m) => ({ ...m, [key]: v }))
  const applyPreset = (p) =>
    setMacro({ unemp: p.unemp, gdp: p.gdp, int_r: p.int_r, inf: p.inf, sent: p.sent, fx: p.fx, oil: p.oil })

  // 분기 편집 — 거시 7요인은 q.macro 안에, 속보/힌트는 q 위에.
  const setQMacro = (idx, key, v) =>
    setQuarters((qs) => qs.map((q, i) => (i === idx ? { ...q, macro: { ...q.macro, [key]: v } } : q)))
  const mergeQMacro = (idx, patch) =>
    setQuarters((qs) => qs.map((q, i) => (i === idx ? { ...q, macro: { ...q.macro, ...patch } } : q)))
  const setQField = (idx, key, v) =>
    setQuarters((qs) => qs.map((q, i) => (i === idx ? { ...q, [key]: v } : q)))
  const fillFromQ1 = () =>
    setQuarters((qs) => qs.map((q, i) => (i === 0 ? q : { ...q, macro: { ...qs[0].macro } })))
  const loadQuarterPreset = (p) => setQuarters(normalizeQuarterConfigs(p.quarters))
  // 엔진·서버에 넘길 분기 세트 — 켜져 있고 형식이 맞을 때만. 아니면 undefined(기존 단일 레짐).
  const activeQuarters = useQuarters && isValidQuarterConfigs(quarters) ? quarters : undefined

  const resetToDefaults = () => {
    setMacro(defaultMacro())
    setSeed(42)
  }

  const ready = stockIds.length > 0 && years.length > 0

  // 새 가격에 맞춰 재무제표·힌트를 결정적으로 다시 만든다(숫자·방향). 헤드라인만 나중에 LLM 교체.
  // regenYears 의 앞 연도가 앵커 — next 모드는 [다음연도], batch 는 [둘째 연도부터 전부].
  const deriveContent = (prices, regenYears) => {
    const macroByYear = {}
    for (const m of macroRows) macroByYear[Number(m.year)] = { rate: Number(m.rate), cpi: Number(m.cpi) }
    // 재무 파생에 쓸 연말 금리·물가: 분기 사용 중이면 마지막 분기(Q4)=연말 상태, 아니면 단일 슬라이더.
    const yrEnd = activeQuarters ? activeQuarters[3].macro : macro
    for (const y of regenYears) macroByYear[y] = { rate: Number(yrEnd.int_r), cpi: Number(yrEnd.inf) }
    return buildDerivedContent({
      prices,
      stocks,
      financials,
      macroByYear,
      roundYearMap: game?.round_year_map ?? {},
      finalYear,
      regenYears,
    })
  }

  const generate = () => {
    if (mode === 'next') {
      if (!nextReady) return
      const { betaFx, betaOil } = deriveSectorBetas(seed, stockIds.length)
      const currentPrices = Object.fromEntries(
        stocks.map((s) => [s.id, Number(s.prices?.[String(currentRoundYear)]) || 10000]),
      )
      try {
        // returnPath: 스텝 252개의 전체 경로. 마지막 원소가 그 연도의 확정가(연말값)다.
        const nextPaths = simulateNextRound({
          stockIds,
          currentPrices,
          macro,
          seed,
          betaFx,
          betaOil,
          quarters: activeQuarters,
          returnPath: true,
        })
        const nextPrices = Object.fromEntries(
          stockIds.map((id) => [id, nextPaths[id][nextPaths[id].length - 1]]),
        )

        // 다음 라운드 값 하나만 뚝 떨어뜨리지 않고, 이미 확정된 과거 라운드 궤적(R1~현재)을
        // 그대로 이어 붙인다 — 차트에서 "지금까지 흐름 대비 이번 충격이 튀는지"를 볼 수 있게.
        const historicalYears = years.filter((y) => y <= currentRoundYear).map(String)
        const forecastYear = String(nextRoundYear)
        const displayYears = [...historicalYears, forecastYear]

        const prices = {}
        stockIds.forEach((id) => {
          const stock = stocks.find((s) => s.id === id)
          const row = {}
          historicalYears.forEach((y) => {
            row[y] = Number(stock?.prices?.[y]) || 10000
          })
          row[forecastYear] = nextPrices[id]
          prices[id] = row
        })
        // admin_apply_simulated_prices는 stocks.prices를 통째로 교체한다(병합 아님) — 새 연도
        // 가격만 보내면 나머지 연도가 전부 날아간다(전 종목 거래정지 버그의 원인이었다).
        // 라운드별로 한 칸씩 만들 때 이미 만들어 둔 다른 연도(과거·미래)가 사라지지 않도록,
        // 종목의 기존 전 연도 + 이번 예측 연도를 다 담아 보낸다.
        const applyPrices = Object.fromEntries(
          stockIds.map((id) => {
            const stock = stocks.find((s) => s.id === id)
            return [id, { ...(stock?.prices ?? {}), [forecastYear]: nextPrices[id] }]
          }),
        )

        setPreview({
          prices,
          applyPrices,
          paths: nextPaths, // { [id]: number[252] } — 적용 시 stock_price_paths에 저장
          pathYear: Number(nextRoundYear),
          displayYears,
          forecastYears: [forecastYear],
          betaFx,
          betaOil,
          derived: deriveContent(prices, [Number(nextRoundYear)]),
        })

        const items = generateMacroNews(macro, prevMacro, nextRoundNumber)
        const composed = composeNews(items)
        setNewsHeadline(composed.headline)
        setNewsBody(composed.body)
        setNewsSectors([...new Set(items.flatMap((it) => it.sectors))])
        setNewsSource('rule')
        setPrevMacro(macro)
      } catch (e) {
        notify(e?.message ?? String(e), 'down')
      }
      return
    }

    if (!ready) return
    const macroByYear = Object.fromEntries(years.map((y) => [String(y), macro]))
    const { betaFx, betaOil } = deriveSectorBetas(seed, stockIds.length)
    try {
      // 엔진 트랙: 연도별 raw 252경로를 받는다. { [id]: { [year]: number[252] } }
      const gen = generatePriceSeries({
        stockIds,
        years: years.map(String),
        seed,
        macroByYear,
        betaFx,
        betaOil,
        quarters: activeQuarters,
        returnPath: true,
      })
      // 미리보기·표는 각 경로의 끝값(연말 종가)만 쓴다
      const prices = Object.fromEntries(
        stockIds.map((id) => [id, Object.fromEntries(Object.entries(gen[id]).map(([y, p]) => [y, p[p.length - 1]]))]),
      )
      setPreview({
        prices,
        applyPrices: prices,
        paths: gen, // { [id]: { [year]: number[252] } } — 다연도 배치 → RPC가 stock_price_paths에 통째 저장
        pathYear: null, // 다연도 형태이므로 단일 연도 인자는 없음
        displayYears: years.map(String),
        forecastYears: [],
        betaFx,
        betaOil,
        derived: deriveContent(prices, years.slice(1).map(Number)),
      })
      setNewsHeadline('')
      setNewsBody('')
      setNewsSectors([])
      setNewsSource(null)
    } catch (e) {
      notify(e?.message ?? String(e), 'down')
    }
  }

  // 미리보기가 이미 떠 있으면 — 파라미터(다이얼·슬라이더·분기·시드)를 만질 때마다 자동으로 다시 생성.
  // 첫 생성은 [▶ 미리보기 생성] 버튼(마운트 시 무거운 계산 방지). 이후엔 슬라이더가 곧 차트다.
  const genRef = useRef(generate)
  genRef.current = generate
  useEffect(() => {
    if (!preview) return
    const t = setTimeout(() => genRef.current(), 280)
    return () => clearTimeout(t)
    // preview는 의도적으로 제외 — generate가 preview를 세팅하므로 넣으면 무한 루프
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [macro, quarters, useQuarters, seed, mode, stockIds, genRound])

  // ✨ AI 속보 재생성 — Gemini 우선, 키가 없거나 호출 실패면 규칙 기반으로 조용히 대체된다
  // (newsService.js가 이미 그 대체를 처리하므로 여기선 결과만 반영하면 된다).
  const regenerateWithAI = async () => {
    setAiBusy(true)
    try {
      const result = await generateBreakingNews({
        actions,
        macro,
        prevMacro,
        round: nextRoundNumber,
        stocks,
        moves: previewMoves(),
      })
      const composed = composeNews(result.items)
      setNewsHeadline(composed.headline)
      setNewsBody(composed.body)
      setNewsSectors([...new Set(result.items.flatMap((it) => it.sectors))])
      setNewsSource(result.source)
      if (result.source === 'rule' && result.error) {
        notify(`AI 속보 실패 (규칙 기반 대체): ${result.error}`, 'down')
      }
    } catch (e) {
      notify(e?.message ?? String(e), 'down')
    } finally {
      setAiBusy(false)
    }
  }

  // ✨ 힌트 헤드라인만 Gemini로 다듬는다 — impact·grade·related·round(숫자·방향)는 안 건드린다.
  const refineHints = async () => {
    if (!preview?.derived?.hints?.length) return
    setHintAiBusy(true)
    try {
      const { hints, source, error } = await refineHintHeadlines(preview.derived.hints, namesById)
      setPreview((p) => (p ? { ...p, derived: { ...p.derived, hints } } : p))
      if (source === 'gemini') notify('힌트 문장을 AI로 다듬었어요', 'gold')
      else if (error) notify(`AI 힌트 실패 (템플릿 유지): ${error}`, 'down')
      else notify('Gemini 키가 없어요 — 위 [Gemini 키]에 붙여넣으세요', 'down')
    } finally {
      setHintAiBusy(false)
    }
  }

  const apply = async () => {
    if (!preview) return
    setBusy(true)
    const r = await actions.applySimulatedPrices(preview.applyPrices, preview.paths ?? null, preview.pathYear ?? null)
    setBusy(false)
    setConfirmApply(false)
    if (!r.ok) return notify(errorText(r.error), 'down')
    const n = (r.scalar_applied ?? 0) || (r.paths_applied ?? 0) || stockIds.length
    notify(`${n}개 종목 가격을 반영했어요${r.paths_applied ? ` (장중 경로 ${r.paths_applied}종목)` : ''}`, 'gold')
    await applyDerived()
    // 전체 라운드 일괄 모드 — 같은 4분기 레짐을 전 라운드에 저장
    await persistQuarters(Object.keys(game?.round_year_map ?? {}).map(Number).filter(Boolean))
    setPreview(null)
    await refresh()
  }

  // 가격과 함께 재무제표·힌트도 반영한다. 가격 적용이 성공한 뒤에만 부른다.
  const applyDerived = async () => {
    const d = preview?.derived
    if (!d || (d.financials.length === 0 && d.replaceRounds.length === 0)) return
    if (typeof actions.applyGeneratedContent !== 'function') return // 마이그레이션 미배포 시 조용히 건너뜀
    const gc = await actions.applyGeneratedContent(d.financials, d.hints, d.replaceRounds)
    if (!gc.ok) notify('가격은 됐지만 재무·힌트 반영 실패: ' + errorText(gc.error), 'down')
    else notify(`재무 ${gc.financials}행 · 힌트 ${gc.hints}개도 반영했어요`, 'gold')
  }

  // 분기 파라미터·속보·힌트를 라운드별로 서버에 저장한다(round_quarter_configs, 0048).
  // 학생 화면 get_quarter_events()가 이걸 읽어 장중 분기 전환 시 토스트를 띄운다.
  // [사용]이 꺼져 있으면 아무것도 저장하지 않는다(이번 라운드 분기 config를 지우진 않는다 — 필요하면 관리자가 명시적으로).
  const persistQuarters = async (rounds) => {
    if (!activeQuarters || typeof actions.upsertRoundQuarterConfig !== 'function') return
    let failed = 0
    for (const r of rounds) {
      const res = await actions.upsertRoundQuarterConfig(r, activeQuarters)
      if (!res.ok) failed += 1
    }
    if (failed) notify(`분기 설정 저장 일부 실패 (${failed}개 라운드) — 0048 마이그레이션 확인`, 'down')
  }

  // 다음 라운드 적용 + 속보 발행. DB 트랜잭션 하나가 아니라 RPC 3번(백업→가격 적용→속보)을
  // 순서대로 부르는 것이다 — "원자적"은 UI/UX 관점(버튼 하나, 확인 한 번)이고, 중간에 실패하면
  // 그 단계에서 멈추고 뭐가 됐고 뭐가 안 됐는지 정확히 알린다(자동 롤백은 하지 않는다).
  const applyWithNews = async () => {
    if (!preview) return
    setBusy(true)

    const backupName = `자동백업 R${currentRound}·${new Date().toISOString().slice(0, 10)}`
    const backup = await actions.saveDataset(backupName, '주가 생성기 적용 전 자동 백업')
    if (!backup.ok) {
      setBusy(false)
      notify('자동 백업에 실패해 적용을 중단했어요: ' + errorText(backup.error), 'down')
      return
    }

    const applied = await actions.applySimulatedPrices(
      preview.applyPrices,
      preview.paths ?? null,
      preview.pathYear ?? null,
    )
    if (!applied.ok) {
      setBusy(false)
      notify(`백업(${backupName})은 됐지만 가격 적용에 실패했어요: ` + errorText(applied.error), 'down')
      return
    }

    const broadcastText = newsBody.trim() ? `${newsHeadline}\n${newsBody}` : newsHeadline
    const sent = broadcastText.trim() ? await actions.sendBroadcast(broadcastText) : { ok: true }

    await applyDerived()
    // 다음 라운드만 — 그 라운드에 분기 레짐 저장
    await persistQuarters([nextRoundNumber])

    setBusy(false)
    setConfirmApplyNews(false)
    if (!sent.ok) {
      notify('가격은 반영됐지만 속보 발행에 실패했어요: ' + errorText(sent.error), 'down')
    } else {
      notify(`R${nextRoundNumber} 가격을 반영하고 속보를 발행했어요 (백업: ${backupName})`, 'gold')
    }
    setPreview(null)
    await refresh()
  }

  const yoyOf = (id, i) => {
    if (i === 0 || !preview) return null
    const ys = preview.displayYears
    const cur = preview.prices[id][ys[i]]
    const prev = preview.prices[id][ys[i - 1]]
    return prev ? ((cur - prev) / prev) * 100 : null
  }

  const toggleStock = (id) =>
    setVisible((v) => {
      const next = new Set(v)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const selectAll = () => setVisible(new Set(stockIds))
  const selectNone = () => setVisible(new Set())
  const toggleSector = (sector) => {
    const idsInSector = stocks.filter((s) => classifySector(s) === sector).map((s) => s.id)
    const allOn = idsInSector.every((id) => visible.has(id))
    setVisible((v) => {
      const next = new Set(v)
      idsInSector.forEach((id) => (allOn ? next.delete(id) : next.add(id)))
      return next
    })
  }

  const chartSeries = useMemo(() => {
    if (!preview) return []
    const ys = preview.displayYears
    const forecastSet = new Set(preview.forecastYears ?? [])
    return stockIds
      .filter((id) => visible.has(id))
      .map((id) => {
        const stock = stocks.find((s) => s.id === id)
        const values = ys.map((y, i) => ({
          year: y,
          price: preview.prices[id][y],
          yoy: yoyOf(id, i),
          confirmed: !forecastSet.has(y),
        }))
        return { id, name: stock?.name ?? id, color: colorFor(stock), values }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, visible, stockIds, stocks])

  const started = (game?.current_round ?? 0) > 0

  return (
    <div className="apanel sim-layout">
      <div className="sim-controls">
      <section className="acard">
        <div className="acard-head">
          <span className="acap">생성 방식</span>
        </div>
        <div className="frow two" style={{ flexWrap: 'wrap' }}>
          <button
            type="button"
            className={'sim-chip' + (mode === 'batch' ? ' on' : '')}
            onClick={() => setMode('batch')}
          >
            전체 라운드 일괄
          </button>
          <button type="button" className={'sim-chip' + (mode === 'next' ? ' on' : '')} onClick={() => setMode('next')}>
            다음 라운드만 (P_t → P_t+1)
          </button>
        </div>
        {mode === 'next' && (
          <div className="sim-genround">
            <div className="sim-genround-step">
              <button
                type="button"
                aria-label="이전 라운드"
                disabled={genRound <= 1}
                onClick={() => setGenRound(genRound - 1)}
              >
                –
              </button>
              <b>
                R{genRound} → R{nextRoundNumber}
                {currentRoundYear && nextRoundYear ? ` (${currentRoundYear} → ${nextRoundYear})` : ''}
              </b>
              <button
                type="button"
                aria-label="다음 라운드"
                disabled={nextRoundNumber > totalRounds}
                onClick={() => setGenRound(genRound + 1)}
              >
                +
              </button>
            </div>
            <p className="anote">
              {nextReady
                ? `R${genRound}(${currentRoundYear}년) 가격을 시작가로 R${nextRoundNumber}(${nextRoundYear}년) 한 해만 생성합니다. 대회 시작 전에도 라운드별로 하나씩 미리 만들 수 있어요.`
                : '종목 또는 라운드 연도 정보가 아직 없어요 — [종목·가격]·[데이터셋] 탭을 먼저 확인해주세요.'}
            </p>
            {nextReady && (
              <p className="anote">
                {genRound < 2
                  ? '힌트는 R2부터예요 — 이 단계(R1→R2)에선 안 나오고, 다음 단계(R2→R3 생성)에서 R2 힌트가 만들어집니다. (R1은 원래 힌트 없음)'
                  : `이 단계에서 ${genRound === 2 ? 'R2' : `R2~R${genRound}`} 힌트가 이 가격에 맞춰 (다시) 만들어집니다.`}
              </p>
            )}
          </div>
        )}
      </section>

      <details className="acard sim-gemini" open={!keySet}>
        <summary className="acard-head">
          <span className="acap">Gemini 키 (선택 — 속보·힌트 문장용)</span>
          <span className={keySet ? 'chip ok' : 'chip'}>
            {keySet ? '키 있음 · AI 문장' : '키 없음 · 규칙 템플릿'}
          </span>
        </summary>
        {keySet ? (
          <button type="button" className="text-btn tiny danger" onClick={removeKey}>
            키 지우기
          </button>
        ) : (
          <div className="frow two" style={{ alignItems: 'center' }}>
            <input
              type="password"
              placeholder="AIza…  (자기 Gemini API 키)"
              value={keyInput}
              autoComplete="off"
              onChange={(e) => setKeyInput(e.target.value)}
            />
            <button type="button" className="text-btn" disabled={!keyInput.trim()} onClick={saveKey}>
              저장
            </button>
          </div>
        )}
        <div className="frow two" style={{ alignItems: 'center', marginTop: 8 }}>
          <input
            placeholder="모델명 (기본 gemini-3.6-flash)"
            value={modelInput}
            onChange={(e) => setModelInput(e.target.value)}
          />
          <button type="button" className="text-btn" onClick={saveModel}>
            모델 저장
          </button>
        </div>
        <p className="anote">
          키·모델은 이 브라우저에만 저장돼요(탭 닫으면 사라짐). Google로만 전송되고 파일·서버·다른
          사용자에게 안 갑니다. 404가 나면(Google이 모델을 갈아치움) 위 칸에 새 모델명을 넣으세요.
          키가 없으면 문장은 규칙 템플릿 — <b>숫자·방향은 키와 무관하게 항상 정확</b>.
        </p>
      </details>

      <section className="acard">
        <div className="acard-head">
          <span className="acap">프리셋 시나리오</span>
        </div>
        <div className="frow two" style={{ flexWrap: 'wrap' }}>
          {PRESETS.map((p) => (
            <button key={p.key} className="text-btn" onClick={() => applyPreset(p)}>
              {p.label}
            </button>
          ))}
        </div>
      </section>

      <section className="acard toss">
        <p className="toss-h">시장 흐름 설정</p>
        <p className="toss-sub">
          경기·금리·대외 여건만 고르면 나머지 흔들림은 엔진이 알아서 만들어요.
          {mode === 'batch' ? ' 전 라운드에 같은 흐름이 적용됩니다.' : ' 다음 라운드에 적용됩니다.'}
        </p>

        <Segmented
          size="sm"
          ariaLabel="흐름 방식"
          options={[
            { id: 'one', label: '라운드 내내 한 흐름' },
            { id: 'four', label: '분기마다 바뀜' },
          ]}
          value={useQuarters ? 'four' : 'one'}
          onChange={(v) => setUseQuarters(v === 'four')}
        />

        {!useQuarters ? (
          /* ── 라운드 내내 한 흐름 ── */
          <div style={{ marginTop: 18 }}>
            {wizStep < MACRO_DIALS.length ? (
              (() => {
                const d = MACRO_DIALS[wizStep]
                const cur = activeLevelId(d, macro)
                return (
                  <div className="sim-wiz">
                    <div className="sim-wiz-dots" aria-hidden="true">
                      {MACRO_DIALS.map((_, i) => (
                        <span key={i} className={'d' + (i === wizStep ? ' on' : i < wizStep ? ' done' : '')} />
                      ))}
                    </div>
                    <p className="sim-wiz-q">
                      <span className="n">
                        {wizStep + 1}/{MACRO_DIALS.length}
                      </span>
                      {DIAL_Q[d.key] ?? d.label}
                    </p>
                    <div className="sim-wiz-opts">
                      {d.levels.map((lv) => (
                        <button
                          key={lv.id}
                          type="button"
                          className={'sim-wiz-opt' + (cur === lv.id ? ' on' : '')}
                          onClick={() => {
                            setMacro((m) => ({ ...m, ...lv.macro }))
                            setWizStep((s) => s + 1)
                          }}
                        >
                          {lv.label}
                        </button>
                      ))}
                    </div>
                    <div className="sim-wiz-nav">
                      {wizStep > 0 && (
                        <button type="button" className="text-btn tiny" onClick={() => setWizStep((s) => s - 1)}>
                          ← 이전
                        </button>
                      )}
                      <button
                        type="button"
                        className="text-btn tiny"
                        onClick={() => setWizStep(MACRO_DIALS.length)}
                      >
                        전체 보기 →
                      </button>
                    </div>
                  </div>
                )
              })()
            ) : (
              <div className="sim-wiz-summary">
                {MACRO_DIALS.map((d, i) => {
                  const cur = d.levels.find((l) => l.id === activeLevelId(d, macro))
                  return (
                    <button
                      key={d.key}
                      type="button"
                      className="sim-wiz-sumrow"
                      onClick={() => setWizStep(i)}
                    >
                      <span className="k">{d.label}</span>
                      <span className="v">{cur ? cur.label : '직접 설정'}</span>
                      <span className="x">{d.fmt(macro)}</span>
                    </button>
                  )
                })}
                <button type="button" className="text-btn tiny" onClick={() => setWizStep(0)}>
                  설문 다시
                </button>
              </div>
            )}
            <button
              type="button"
              className="text-btn tiny"
              onClick={() => {
                resetToDefaults()
                setWizStep(MACRO_DIALS.length)
              }}
            >
              처음값으로
            </button>
            <details style={{ marginTop: 6 }}>
              <summary className="text-btn tiny">숫자로 직접 (슬라이더)</summary>
              <div className="form" style={{ marginTop: 10 }}>
                {MACRO_FIELDS.map((f) => (
                  <div key={f.key} className="frow col">
                    <label htmlFor={`sim-${f.key}`}>{f.label}</label>
                    <div className="sim-dual">
                      <input
                        type="range"
                        aria-label={`${f.label} (슬라이더)`}
                        min={f.min}
                        max={f.max}
                        step={f.step}
                        value={macro[f.key]}
                        onChange={(e) => setField(f.key, Number(e.target.value))}
                      />
                      <input
                        id={`sim-${f.key}`}
                        className="num"
                        type="number"
                        min={f.min}
                        max={f.max}
                        step={f.step}
                        value={macro[f.key]}
                        onChange={(e) => setField(f.key, Number(e.target.value))}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </details>
          </div>
        ) : (
          /* ── 분기마다 바뀜 ── */
          <div style={{ marginTop: 16 }}>
            <p className="lbl" style={{ marginBottom: 8 }}>빠른 시작 — 이야기를 고르세요</p>
            <div className="preset-cards">
              {QUARTER_PRESETS.map((p) => (
                <button key={p.key} type="button" className="preset-card" onClick={() => loadQuarterPreset(p)}>
                  <div className="pc-name">{p.label}</div>
                  <div className="pc-desc">{PRESET_DESC[p.key] ?? ''}</div>
                  <QuarterSpark quarters={p.quarters} />
                </button>
              ))}
            </div>

            {/* 4분기 요약 = 분기 선택기 */}
            <div className="q-mood">
              {quarters.map((q, i) => (
                <button
                  key={i}
                  type="button"
                  className={'qm' + (qSel === i ? ' on' : '')}
                  onClick={() => setQSel(i)}
                >
                  <span className="qn">
                    Q{i + 1} · {i * 3 + 1}~{i * 3 + 3}월
                  </span>
                  <span className="qv">{quarterMood(q.macro)}</span>
                </button>
              ))}
            </div>

            {/* 선택 분기 손잡이 */}
            <div className="q-block">
              <div className="q-block-h">
                Q{qSel + 1} · {qSel * 3 + 1}~{qSel * 3 + 3}월
              </div>
              {MACRO_DIALS.map((d) => (
                <div key={d.key} className="q-dial">
                  <span className="lbl">{d.label}</span>
                  <Segmented
                    ariaLabel={`Q${qSel + 1} ${d.label}`}
                    options={d.levels}
                    value={activeLevelId(d, quarters[qSel].macro)}
                    onChange={(id) => mergeQMacro(qSel, d.levels.find((l) => l.id === id).macro)}
                  />
                  <div className="toss-num">{d.fmt(quarters[qSel].macro)}</div>
                </div>
              ))}
              <div className="q-dial">
                <span className="lbl">이 분기 시작에 뜨는 속보 (선택)</span>
                <input
                  aria-label={`Q${qSel + 1} 분기 속보`}
                  placeholder="예: 금리 급등·경기 침체 — 시장 전반 급락"
                  value={quarters[qSel].eventNews}
                  onChange={(e) => setQField(qSel, 'eventNews', e.target.value)}
                />
              </div>
              <div className="q-dial">
                <span className="lbl">이 분기 힌트 (선택)</span>
                <input
                  aria-label={`Q${qSel + 1} 분기 힌트`}
                  placeholder="예: 방어적으로 접근하세요"
                  value={quarters[qSel].hintText}
                  onChange={(e) => setQField(qSel, 'hintText', e.target.value)}
                />
              </div>
              <button type="button" className="text-btn tiny" onClick={fillFromQ1}>
                Q1 흐름을 전 분기에 복사
              </button>
            </div>

            <details style={{ marginTop: 12 }}>
              <summary className="text-btn tiny">정밀 조정 — 숫자로 직접</summary>
              <div className="scroller" style={{ marginTop: 10 }}>
                <table className="q-grid">
                  <thead>
                    <tr>
                      <th></th>
                      {quarters.map((q, i) => (
                        <th key={q.quarter}>
                          Q{q.quarter}
                          <div className="sub">
                            {i * 3 + 1}~{i * 3 + 3}월
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {MACRO_FIELDS.map((f) => (
                      <tr key={f.key}>
                        <th scope="row">{f.short}</th>
                        {quarters.map((q, i) => (
                          <td key={i}>
                            <input
                              className="num"
                              type="number"
                              aria-label={`Q${i + 1} ${f.label}`}
                              min={f.min}
                              max={f.max}
                              step={f.step}
                              value={q.macro[f.key]}
                              onChange={(e) => setQMacro(i, f.key, Number(e.target.value))}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

            <p className="anote" style={{ marginTop: 12 }}>
              63거래일마다 그 분기 흐름으로 통째로 바뀝니다 — 가격은 이어지고(점프 없음), 연말값은 그대로 확정가.
              [적용] 시 학생 화면은 분기가 넘어갈 때 그 속보·힌트를 토스트로 봅니다.
            </p>
          </div>
        )}

        {/* 시드 — 두 모드 공통 */}
        <div className="q-dial" style={{ marginTop: 18 }}>
          <span className="lbl">시드 · 같은 값이면 같은 결과</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              id="sim-seed"
              className="num"
              type="number"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value) || 0)}
            />
            <button
              type="button"
              className="text-btn tiny"
              onClick={() => setSeed(Math.floor(Math.random() * 1_000_000_000))}
            >
              🎲 새로 섞기
            </button>
          </div>
        </div>
      </section>

      <section className="acard">
        <div className="acard-head">
          <span className="acap">실행</span>
        </div>
        {!ready && (
          <p className="awarn">
            종목 또는 라운드 연도가 아직 없어요 — 먼저 [종목·가격]·[데이터셋] 탭에서 설정해주세요.
          </p>
        )}
        {mode === 'batch' && started && (
          <p className="awarn">
            대회가 시작된 뒤입니다. 적용하면 <b>이후 평가·체결에 즉시 반영</b>됩니다(이미 체결된 거래는 그대로).
            이미 등록된 힌트와 방향이 맞는지 확인해주세요.
          </p>
        )}
        <button className="text-btn" disabled={mode === 'batch' ? !ready : !nextReady} onClick={generate}>
          ▶ 미리보기 생성
        </button>
        {preview && (
          <p className="anote">
            미리보기가 떠 있는 동안엔 <b>다이얼·슬라이더·분기·시드를 만지면 자동으로 다시 그려져요</b>{' '}
            (속보·힌트 문장은 [✨] 버튼으로 따로).
          </p>
        )}
      </section>
      </div>

      <div className="sim-preview">
      {!preview && (
        <section className="acard sim-preview-empty">
          <p className="aempty">
            왼쪽에서 흐름을 설정한 뒤 <b>[▶ 미리보기 생성]</b>을 누르면 차트·정합성 체크·적용이 여기 나와요.
          </p>
        </section>
      )}
      {preview && (
        <>
          <section className="acard">
            <div className="acard-head">
              <span className="acap">미리보기 차트</span>
            </div>
            <div className="frow two sim-filters" style={{ flexWrap: 'wrap' }}>
              <button type="button" className="text-btn tiny" onClick={selectAll}>
                전체 선택
              </button>
              <button type="button" className="text-btn tiny" onClick={selectNone}>
                전체 해제
              </button>
              {sectors.map((sec) => {
                const idsInSector = stocks.filter((s) => classifySector(s) === sec).map((s) => s.id)
                const on = idsInSector.every((id) => visible.has(id))
                return (
                  <button
                    key={sec}
                    type="button"
                    className={'sim-chip' + (on ? ' on' : '')}
                    style={{ '--chip-color': sectorColor[sec] }}
                    onClick={() => toggleSector(sec)}
                  >
                    {sec}
                  </button>
                )
              })}
            </div>
            <PreviewChart years={preview.displayYears} series={chartSeries} />
          </section>

          {mode === 'next' && (
            <section className="acard">
              <div className="acard-head">
                <span className="acap">
                  📢 생성될 시장 속보 미리보기
                  {newsSource === 'gemini' && <span className="sim-forecast-tag">✨ AI 생성</span>}
                </span>
                <button type="button" className="text-btn" disabled={aiBusy} onClick={regenerateWithAI}>
                  {aiBusy ? '✨ 생성 중…' : '✨ AI 속보 재생성'}
                </button>
              </div>
              <div className="form">
                <div className="frow col">
                  <label htmlFor="news-headline">헤드라인</label>
                  <input
                    id="news-headline"
                    value={newsHeadline}
                    onChange={(e) => setNewsHeadline(e.target.value)}
                  />
                </div>
                <div className="frow col">
                  <label htmlFor="news-body">본문</label>
                  <textarea
                    id="news-body"
                    rows={4}
                    value={newsBody}
                    onChange={(e) => setNewsBody(e.target.value)}
                  />
                </div>
              </div>
              {newsSectors.length > 0 && (
                <p className="anote">영향 섹터: {newsSectors.join(', ')}</p>
              )}
              <p className="anote">
                이 속보는 [다음 라운드 주가 적용 및 속보 발행]을 눌러야 전 조에 실제로 발송됩니다. 발행 전엔
                자유롭게 고쳐도 됩니다.
              </p>
            </section>
          )}

          {preview.derived && (
            <section className="acard">
              <div className="acard-head">
                <span className="acap">재무·힌트 재생성 (가격에 맞춰 자동 계산)</span>
                {preview.derived.check.mismatches.length === 0 ? (
                  <span className="chip ok">
                    정합성 OK · 힌트 {preview.derived.check.checked}건 대조
                  </span>
                ) : (
                  <span className="chip warn">불일치 {preview.derived.check.mismatches.length}건</span>
                )}
                <button
                  type="button"
                  className="text-btn"
                  disabled={hintAiBusy || !preview.derived.hints.length}
                  onClick={refineHints}
                >
                  {hintAiBusy ? '✨ 다듬는 중…' : '✨ AI로 힌트 문장 다듬기'}
                </button>
              </div>
              <p className="anote">
                재무제표 <b>{preview.derived.financials.length}행</b> · 힌트{' '}
                <b>{preview.derived.hints.length}개</b>
                {preview.derived.replaceRounds.length > 0 && ` (R${preview.derived.replaceRounds.join(', R')})`}
                가 이 가격에 맞춰 다시 계산됐어요. [적용]을 누르면 가격과 함께 반영됩니다.
              </p>
              {preview.derived.check.mismatches.length > 0 && (
                <>
                  <p className="awarn">
                    힌트 방향이 등락과 어긋나 적용이 막혀 있어요. 시드를 바꿔 다시 생성해 보세요.
                  </p>
                  <ul className="anote" style={{ color: 'var(--down)' }}>
                    {preview.derived.check.mismatches.slice(0, 8).map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}

          <section className="acard">
            <div className="acard-head">
              <span className="acap">미리보기 표 (아직 저장 안 됨)</span>
              {mode === 'batch' ? (
                <button
                  className="text-btn"
                  disabled={busy || preview.derived?.check.mismatches.length > 0}
                  onClick={() => setConfirmApply(true)}
                >
                  이 가격 적용
                </button>
              ) : (
                <button
                  className="text-btn"
                  disabled={busy || preview.derived?.check.mismatches.length > 0}
                  onClick={() => setConfirmApplyNews(true)}
                >
                  다음 라운드 주가 적용 및 속보 발행
                </button>
              )}
            </div>
            <div className="scroller">
              <table>
                <thead>
                  <tr>
                    <th></th>
                    <th>종목</th>
                    {preview.displayYears.map((y) => (
                      <th key={y}>
                        {y}
                        {preview.forecastYears?.includes(y) && <span className="sim-forecast-tag">예측</span>}
                      </th>
                    ))}
                    <th>betaFx</th>
                    <th>betaOil</th>
                  </tr>
                </thead>
                <tbody>
                  {stockIds.map((id, i) => {
                    const stock = stocks.find((s) => s.id === id)
                    return (
                      <tr key={id}>
                        <td>
                          <input
                            type="checkbox"
                            checked={visible.has(id)}
                            onChange={() => toggleStock(id)}
                            aria-label={`${stock?.name ?? id} 차트에 표시`}
                          />
                        </td>
                        <td>{stock?.name ?? id}</td>
                        {preview.displayYears.map((y, yi) => {
                          const yoy = yoyOf(id, yi)
                          return (
                            <td key={y} className="num">
                              {num(preview.prices[id][y])}
                              {yoy != null && <div className={'sub ' + dirOf(yoy)}>{pct(yoy)}</div>}
                            </td>
                          )
                        })}
                        <td className="num">{preview.betaFx[i].toFixed(1)}</td>
                        <td className="num">{preview.betaOil[i].toFixed(1)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      </div>

      <Modal open={confirmApply} onClose={() => setConfirmApply(false)} title="시뮬레이션 가격 적용">
        <div className="confirm">
          <p className="big">
            <b>{stockIds.length}개 종목</b>의 가격을 위 미리보기 값으로 덮어씁니다.
          </p>
          <p className="ask">기존 가격은 되돌릴 수 없어요. 계속할까요?</p>
        </div>
        <div className="mfoot">
          <button className="cancel" onClick={() => setConfirmApply(false)}>
            취소
          </button>
          <button className="act-btn buy" disabled={busy} onClick={apply}>
            적용
          </button>
        </div>
      </Modal>

      <Modal open={confirmApplyNews} onClose={() => setConfirmApplyNews(false)} title="다음 라운드 적용 + 속보 발행">
        <div className="confirm">
          <p className="big">
            R{nextRoundNumber}({nextRoundYear}년) 가격을 반영하고, 위 속보를 <b>전 조에</b> 즉시 발송합니다.
          </p>
          <p className="ask">
            적용 전 현재 상태를 데이터셋으로 자동 백업합니다. 그래도 되돌리려면 [데이터셋] 탭에서 그 백업을
            불러와야 해요. 계속할까요?
          </p>
        </div>
        <div className="mfoot">
          <button className="cancel" onClick={() => setConfirmApplyNews(false)}>
            취소
          </button>
          <button className="act-btn buy" disabled={busy} onClick={applyWithNews}>
            적용 + 발행
          </button>
        </div>
      </Modal>
    </div>
  )
}
