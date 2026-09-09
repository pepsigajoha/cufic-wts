// 서버에서 게임 상태를 읽어와 화면이 쓰는 모양으로 만든다.
//
// data.js의 더미를 대체한다. data.js는 이제 seed.sql 생성용으로만 남는다
// (scripts/gen-seed.mjs). 화면은 전부 여기서 나온 값을 쓴다.

import { supabase, rpc, select } from './supabase'

/** 라운드 → 연도. 종료 후엔 current_round가 total_rounds를 넘어 round_year_map에 없으므로
 *  final_year(예: 2025)로 폴백한다 — 최종 정산 시 2025 가격을 공개하는 장치. */
export const yearOf = (game, round = game?.current_round) => {
  const y = game?.round_year_map?.[String(round)]
  if (y != null) return y
  if (game?.final_year != null && round != null && round > (game?.total_rounds ?? 0)) return game.final_year
  return null
}

/**
 * stock_price_paths 행들을 { [stock_id]: { [year]: number[] } } 로 접는다.
 * prices는 numeric[](Postgres) → JS에선 number[] 또는 문자열 배열로 올 수 있어 Number()로 정규화.
 */
function foldPricePaths(rows) {
  const out = {}
  for (const r of rows ?? []) {
    const arr = Array.isArray(r.prices) ? r.prices.map((v) => Number(v)) : null
    if (!arr || !arr.length) continue
    ;(out[r.stock_id] ??= {})[Number(r.year)] = arr
  }
  return out
}

/**
 * 종목 + 현재 라운드 시세 + 내 보유를 합친 목록. 화면은 전부 이걸 쓴다.
 * 가격이 없거나 0이면 거래정지 — 0으로 나누는 계산이 생기지 않게 여기서 막는다.
 *
 * price(연말 확정가)는 평가·리더보드·보유목록이 쓴다 — 라운드 중에도 안 흔들린다.
 * 장중 체결가는 execPriceOf(stock, stepIdx)로 따로 뽑는다(pricePath 기준).
 *
 * @param {Array} pricePaths  stock_price_paths 행 목록
 */
export function buildStocks(rawStocks, game, positions, pricePaths = []) {
  const year = yearOf(game)
  const prevYear = year != null ? year - 1 : null
  const round = game?.current_round ?? 0
  const posByCode = Object.fromEntries((positions ?? []).map((p) => [p.stock_id, p]))
  const pathsByStock = foldPricePaths(pricePaths)

  return (rawStocks ?? [])
    .slice()
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
    .map((s) => {
      const raw = year != null ? Number(s.prices?.[String(year)] ?? 0) : 0
      const halted = !raw || raw <= 0
      const price = halted ? 0 : raw
      const prevRaw = prevYear != null ? Number(s.prices?.[String(prevYear)] ?? 0) : 0
      const prev = !prevRaw || prevRaw <= 0 ? price : prevRaw
      const delta = price - prev
      const pos = posByCode[s.id]
      const preListed = round > 0 && round < (s.listed_from_round ?? 1)
      const pricePathsByYear = pathsByStock[s.id] ?? {}
      return {
        code: s.id,
        name: s.name,
        desc: s.description ?? '',
        market: 'KOSPI',
        prices: s.prices ?? {},
        price,
        halted,
        preListed,
        listedFromRound: s.listed_from_round ?? 1,
        delta: halted ? 0 : delta,
        chg: halted || !prev ? 0 : (delta / prev) * 100,
        holding: pos?.quantity ?? 0,
        avgPrice: Number(pos?.avg_price ?? 0),
        // 장중 경로: 현재 연도(있으면) + 연도별 전체(차트 히스토리 조립용)
        pricePath: (year != null && pricePathsByYear[year]) || null,
        pricePathsByYear,
      }
    })
}

/**
 * 장중 스텝(0..251)에 해당하는 체결가. 경로가 없으면 연말 확정가(price)로 폴백.
 * SQL private.exec_price와 같은 의미 — 차트 팁·주문 예상금액이 이 값으로 표시된다.
 */
export function execPriceOf(stock, stepIdx) {
  const p = stock?.pricePath
  if (!Array.isArray(p) || p.length === 0) return stock?.price ?? 0
  const i = Math.max(0, Math.min(p.length - 1, Math.floor(stepIdx || 0)))
  const v = Number(p[i])
  return Number.isFinite(v) && v > 0 ? Math.round(v) : (stock?.price ?? 0)
}

// DB 행 → 화면이 쓰는 모양. 재무제표: { [종목코드]: { [연도]: {입력 7개} } }
// 파생값(자산·부채·자본·영업이익·당기순이익·부채비율·ROE)은 저장하지 않고 화면에서 deriveFinancials로 계산한다.
function shapeFinancials(rows) {
  const out = {}
  for (const r of rows ?? []) {
    ;(out[r.stock_id] ??= {})[r.year] = {
      currentAssets: Number(r.current_assets),
      noncurrentAssets: Number(r.noncurrent_assets),
      currentLiabilities: Number(r.current_liabilities),
      noncurrentLiabilities: Number(r.noncurrent_liabilities),
      revenue: Number(r.revenue),
      operatingExpense: Number(r.operating_expense),
      nonoperatingExpense: Number(r.nonoperating_expense),
    }
  }
  return out
}
// 시황: { [연도]: {summary, rate, gdp, ...} }
function shapeMacro(rows) {
  const out = {}
  for (const r of rows ?? []) {
    out[r.year] = {
      summary: r.summary ?? '',
      kospi: Number(r.kospi),
      sp500: Number(r.sp500),
      nikkei: Number(r.nikkei),
      europe: Number(r.europe),
      rate: Number(r.rate),
      cpi: Number(r.cpi),
      oil: Number(r.oil),
      gold: Number(r.gold),
    }
  }
  return out
}

/**
 * 로그인 후 한 번에 가져오는 초기 데이터. 병렬로 요청한다.
 * 실패하면 화면이 통째로 죽는 대신 {ok:false}를 돌려준다.
 */
export async function loadAll(teamCode, teamId) {
  const [game, stocks, paths, positions, trades, hints, snaps, board, me, cash, bcast, fin, macro, optionsContracts, myOptions, savings] =
    await Promise.all([
      select('game_state', '*'),
      select('stocks', '*'),
      select('stock_price_paths', 'stock_id,year,prices'),
      select('positions', '*', (q) => q.eq('team_id', teamId)),
      select('trades', '*', (q) => q.eq('team_id', teamId).order('created_at', { ascending: false })),
      rpc('get_my_hints', { p_team_code: teamCode }),
      select('round_snapshots', '*', (q) => q.eq('team_id', teamId).order('round')),
      rpc('leaderboard'),
      select('public_teams', '*', (q) => q.eq('id', teamId)),
      rpc('team_cash', { p_team_id: teamId }),
      select('broadcasts', '*', (q) => q.order('id', { ascending: false })),
      rpc('get_financials'), // 현재 라운드 연도까지만 (서버가 미래 연도 차단)
      rpc('get_macro'),
      select('options_contracts', '*', (q) => q.eq('active', true)),
      select('user_options_positions', '*', (q) => q.eq('team_id', teamId).order('created_at', { ascending: false })),
      select('user_savings', '*', (q) => q.eq('team_id', teamId).eq('status', 'active').order('id')),
    ])

  // stock_price_paths·user_savings는 하위호환용 — 그 마이그레이션 이전 DB엔 테이블이 없어
  // select가 실패한다. 그 경우 경로 없이(연말 확정가 폴백)·예금 없이 정상 동작해야 하므로 치명 목록에서 뺀다.
  const failed = [
    game, stocks, positions, trades, hints, snaps, board, me, bcast, fin, macro, optionsContracts, myOptions,
  ].find((r) => !r.ok)
  if (failed) return { ok: false, error: failed.error ?? 'network' }

  return {
    ok: true,
    game: game.rows[0] ?? null,
    rawStocks: stocks.rows,
    pricePaths: paths.ok ? paths.rows : [],
    positions: positions.rows,
    trades: trades.rows,
    hints: hints.rows ?? [],
    snapshots: snaps.rows,
    leaderboard: board.rows ?? [],
    broadcasts: bcast.rows ?? [],
    financials: shapeFinancials(fin.rows),
    macro: shapeMacro(macro.rows),
    seed: Number(me.rows[0]?.seed ?? 0), // 원금 — 조마다 다를 수 있다
    cash: Number(cash.value ?? 0),
    optionsContracts: optionsContracts.rows,
    myOptionPositions: myOptions.rows,
    savings: savings.ok ? savings.rows : [],
  }
}

/** 신호를 받았을 때 다시 가져오는 것들 (내 조 데이터 + 공개 데이터) */
export async function refetchMine(teamCode, teamId) {
  const [positions, trades, hints, snaps, board, game, cash, bcast, fin, macro, stocks, paths, optionsContracts, myOptions, savings] =
    await Promise.all([
      select('positions', '*', (q) => q.eq('team_id', teamId)),
      select('trades', '*', (q) => q.eq('team_id', teamId).order('created_at', { ascending: false })),
      rpc('get_my_hints', { p_team_code: teamCode }),
      select('round_snapshots', '*', (q) => q.eq('team_id', teamId).order('round')),
      rpc('leaderboard'),
      select('game_state', '*'),
      rpc('team_cash', { p_team_id: teamId }),
      select('broadcasts', '*', (q) => q.order('id', { ascending: false })),
      rpc('get_financials'),
      rpc('get_macro'),
      select('stocks', '*'), // 팩 전환으로 종목이 통째로 바뀔 수 있어 함께 갱신
      select('stock_price_paths', 'stock_id,year,prices'), // 시뮬레이터 적용/데이터셋 전환으로 바뀔 수 있어 함께 갱신
      select('options_contracts', '*', (q) => q.eq('active', true)),
      select('user_options_positions', '*', (q) => q.eq('team_id', teamId).order('created_at', { ascending: false })),
      select('user_savings', '*', (q) => q.eq('team_id', teamId).eq('status', 'active').order('id')),
    ])
  // paths(stock_price_paths)·savings(user_savings)는 하위호환용 — 마이그레이션 이전 DB엔 테이블이 없다. 치명 목록 제외.
  const failed = [
    positions, trades, hints, snaps, board, game, bcast, fin, macro, stocks, optionsContracts, myOptions,
  ].find((r) => !r.ok)
  if (failed) return { ok: false, error: failed.error ?? 'network' }
  return {
    ok: true,
    positions: positions.rows,
    trades: trades.rows,
    hints: hints.rows ?? [],
    snapshots: snaps.rows,
    leaderboard: board.rows ?? [],
    broadcasts: bcast.rows ?? [],
    financials: shapeFinancials(fin.rows),
    macro: shapeMacro(macro.rows),
    rawStocks: stocks.rows,
    pricePaths: paths.ok ? paths.rows : [],
    game: game.rows[0] ?? null,
    cash: Number(cash.value ?? 0),
    optionsContracts: optionsContracts.rows,
    myOptionPositions: myOptions.rows,
    savings: savings.ok ? savings.rows : [],
  }
}

/**
 * 실시간 신호 구독.
 *
 * [잠정] 힌트는 조별로 격리돼 있어(select 정책 없음) Realtime Postgres Changes로 못 받는다.
 * Realtime은 RLS를 쓰는데 anon은 hint_grants를 볼 수 없기 때문. 그래서 signals 테이블에
 * "무엇이 바뀌었다"만 흘리고, 받으면 각자 자기 데이터를 RPC로 다시 가져온다.
 */
export function subscribeSignals(onSignal, onStatus) {
  // 콜백이 던져도 realtime 내부 디스패처가 깨지지 않게 각 호출을 격리한다.
  const safe = (label, fn) => {
    try {
      fn()
    } catch (e) {
      console.error(`[signals:${label}]`, e)
    }
  }

  // 채널이 한 번이라도 끊겼다가 다시 붙으면, 끊겨 있던 동안의 signals INSERT를 전부
  // 놓친 상태다 — 재구독 순간 한 번 강제로 재동기화하도록 소비자에게 알린다.
  let wasDown = false

  const ch = supabase
    .channel('wts-signals')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'signals' }, (p) => {
      if (!p?.new) return
      safe('onSignal', () => onSignal(p.new))
    })
    // status: 'SUBSCRIBED' | 'TIMED_OUT' | 'CHANNEL_ERROR' | 'CLOSED'
    // supabase-js는 소켓 복구 시 채널을 자동 재구독하고 이 콜백을 다시 부른다.
    .subscribe((status, err) => {
      if (err) console.error('[signals:subscribe]', err)
      const up = status === 'SUBSCRIBED'
      if (!up) wasDown = true
      safe('onStatus', () => onStatus?.(up, up && wasDown /* reconnected */))
      if (up) wasDown = false
    })

  return () => {
    // removeChannel은 Promise를 반환한다 — 정리 경로에서 거부가 새지 않게 삼킨다.
    Promise.resolve(supabase.removeChannel(ch)).catch((e) =>
      console.error('[signals:removeChannel]', e),
    )
  }
}
