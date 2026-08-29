import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminSimulator from './AdminSimulator'
import { generateMacroNews } from './macroNews'
import { generateBreakingNews } from './newsService'

// AdminSimulator가 import하는 ../supabase는 모듈 로드 시 실제 Supabase 클라이언트를 생성하며,
// .env가 없으면(원격 Supabase 자격증명 없이 이 테스트를 돌리는 게 목적) 그 자리에서 예외를 던진다.
// 실제 네트워크 호출은 이 테스트 어디에서도 일어나지 않는다 — RPC는 아래에서 전부
// actions.applySimulatedPrices를 vi.fn()으로 교체해 대신한다. errorText만 가벼운 대역으로 바꾼다.
vi.mock('../supabase', () => ({
  errorText: (code) => `ERR:${code}`,
}))

afterEach(() => {
  cleanup()
  // AdminSimulator는 슬라이더/시드/모드를 sessionStorage에 영속화한다(탭 전환 대비) —
  // 테스트끼리 값이 새면 안 되니 매 테스트 뒤에 지운다.
  sessionStorage.clear()
})

function makeProps(overrides = {}) {
  return {
    actions: {
      applySimulatedPrices: vi.fn(async () => ({ ok: true, applied: 2 })),
      saveDataset: vi.fn(async () => ({ ok: true, id: 99 })),
      sendBroadcast: vi.fn(async () => ({ ok: true, id: 1 })),
      // 기본값은 "Edge Function 미배포/키 없음" 상태 — newsService가 규칙 기반으로 대체한다.
      generateBreakingNews: vi.fn(async () => ({ ok: false, error: 'no_api_key' })),
    },
    game: { current_round: 0, round_year_map: { 1: 2021, 2: 2022 }, final_year: 2023 },
    stocks: [
      { id: 'A001', name: '테스트전자', sector: 'Tech' },
      { id: 'A002', name: '테스트항공', sector: 'Air' },
    ],
    refresh: vi.fn(async () => {}),
    notify: vi.fn(),
    ...overrides,
  }
}

// "다음 라운드만" 모드 테스트용 — 1라운드가 진행 중이고(2021년 공개됨), 각 종목이 실제
// 현재가를 이미 들고 있는 상태.
function makeNextRoundProps(overrides = {}) {
  return makeProps({
    game: { current_round: 1, round_year_map: { 1: 2021, 2: 2022, 3: 2023 }, total_rounds: 3, final_year: 2024 },
    stocks: [
      { id: 'A001', name: '테스트전자', sector: 'Tech', prices: { 2021: 12000 } },
      { id: 'A002', name: '테스트항공', sector: 'Air', prices: { 2021: 8000 } },
    ],
    ...overrides,
  })
}

const generateBtn = () => screen.getByText('▶ 미리보기 생성')

describe('미리보기 생성', () => {
  it('클릭하면 종목×연도 가격 표가 뜬다', async () => {
    const u = userEvent.setup()
    render(<AdminSimulator {...makeProps()} />)
    await u.click(generateBtn())

    expect(screen.getAllByText('테스트전자').length).toBeGreaterThan(0)
    expect(screen.getAllByText('테스트항공').length).toBeGreaterThan(0)
    expect(screen.getByRole('columnheader', { name: '2021' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '2023' })).toBeInTheDocument()
  })

  it('같은 시드로 다시 생성해도 같은 값이 나온다(결정성)', async () => {
    const u = userEvent.setup()
    render(<AdminSimulator {...makeProps()} />)
    await u.click(generateBtn())
    const firstRun = screen.getAllByRole('row').map((r) => r.textContent)

    await u.click(generateBtn())
    const secondRun = screen.getAllByRole('row').map((r) => r.textContent)

    expect(secondRun).toEqual(firstRun)
  })

  it('종목이 없으면 버튼이 비활성화되고 안내 문구가 뜬다', () => {
    render(<AdminSimulator {...makeProps({ stocks: [] })} />)
    expect(generateBtn()).toBeDisabled()
    expect(screen.getByText(/종목 또는 라운드 연도가 아직 없어요/)).toBeInTheDocument()
  })
})

describe('프리셋', () => {
  it('스태그플레이션 위기를 누르면 실업률·환율 입력값이 바뀐다', async () => {
    const u = userEvent.setup()
    render(<AdminSimulator {...makeProps()} />)
    await u.click(screen.getByText('스태그플레이션 위기'))

    expect(screen.getByLabelText('실업률 (%)')).toHaveValue(6)
    expect(screen.getByLabelText('원/달러 환율 (원)')).toHaveValue(1550)
  })
})

describe('슬라이더 ↔ 숫자 입력 동기화', () => {
  it('슬라이더를 움직이면 숫자 입력값도 같이 바뀐다', () => {
    render(<AdminSimulator {...makeProps()} />)
    const slider = screen.getByLabelText('실업률 (%) (슬라이더)')
    fireEvent.change(slider, { target: { value: '7.5' } })
    expect(screen.getByLabelText('실업률 (%)')).toHaveValue(7.5)
  })

  it('숫자 입력을 바꾸면 슬라이더 값도 같이 바뀐다', () => {
    render(<AdminSimulator {...makeProps()} />)
    const numberInput = screen.getByLabelText('실업률 (%)')
    fireEvent.change(numberInput, { target: { value: '9' } })
    expect(screen.getByLabelText('실업률 (%) (슬라이더)')).toHaveValue('9')
  })
})

describe('시드 재생성', () => {
  it('🎲 버튼을 누르면 시드 값이 바뀐다', async () => {
    const u = userEvent.setup()
    render(<AdminSimulator {...makeProps()} />)
    const seedInput = screen.getByLabelText('시드 (재현성)')
    expect(seedInput).toHaveValue(42)

    await u.click(screen.getByText(/시드 재생성/))
    expect(seedInput).not.toHaveValue(42)
  })
})

describe('미리보기 차트', () => {
  it('생성하면 차트와 범례가 뜬다', async () => {
    const u = userEvent.setup()
    render(<AdminSimulator {...makeProps()} />)
    await u.click(generateBtn())

    expect(screen.getByRole('img', { name: '시뮬레이션 미리보기 차트' })).toBeInTheDocument()
  })

  it('[전체 해제] 누르면 범례가 비고, 다시 [전체 선택] 하면 돌아온다', async () => {
    const u = userEvent.setup()
    render(<AdminSimulator {...makeProps()} />)
    await u.click(generateBtn())

    await u.click(screen.getByText('전체 해제'))
    expect(screen.getByText('표시할 종목을 선택해주세요.')).toBeInTheDocument()

    await u.click(screen.getByText('전체 선택'))
    expect(screen.queryByText('표시할 종목을 선택해주세요.')).not.toBeInTheDocument()
  })

  it('종목 체크박스를 끄면 그 종목만 차트에서 빠진다', async () => {
    const u = userEvent.setup()
    render(<AdminSimulator {...makeProps()} />)
    await u.click(generateBtn())

    await u.click(screen.getByLabelText('테스트항공 차트에 표시'))
    expect(screen.getAllByText('테스트전자').length).toBeGreaterThan(0)
    // 범례에는 이제 테스트전자만 남아야 한다(표에는 테스트항공 행이 여전히 있음)
    const legend = document.querySelector('.sim-legend')
    expect(legend.textContent).toContain('테스트전자')
    expect(legend.textContent).not.toContain('테스트항공')
  })

  it('섹터 칩을 누르면 그 섹터 종목이 한 번에 빠졌다 돌아온다', async () => {
    const u = userEvent.setup()
    render(<AdminSimulator {...makeProps()} />)
    await u.click(generateBtn())

    await u.click(screen.getByText('Air'))
    const legend = document.querySelector('.sim-legend')
    expect(legend.textContent).not.toContain('테스트항공')

    await u.click(screen.getByText('Air'))
    expect(legend.textContent).toContain('테스트항공')
  })
})

describe('등락률(YoY) 표시', () => {
  it('첫 연도엔 등락률이 없고, 다음 연도부터는 색이 입혀진 등락률 배지가 뜬다', async () => {
    const u = userEvent.setup()
    render(<AdminSimulator {...makeProps()} />)
    await u.click(generateBtn())

    const badges = document.querySelectorAll('.sub.up, .sub.down, .sub.flat')
    // 종목 2개 × (연도 3개 - 첫 연도 1개) = 최소 4개의 등락률 배지가 있어야 한다
    expect(badges.length).toBeGreaterThanOrEqual(4)
    ;[...badges].forEach((b) => expect(b.textContent).toMatch(/%$/))
  })
})

describe('다음 라운드만 모드 (단일 라운드 산출)', () => {
  it('현재가(P_t)를 시작가로 삼아 다음 라운드 가격(P_t+1) 한 칸만 계산한다', async () => {
    const u = userEvent.setup()
    render(<AdminSimulator {...makeNextRoundProps()} />)

    await u.click(screen.getByText('다음 라운드만 (P_t → P_t+1)'))
    await u.click(generateBtn())

    // 표 헤더가 현재 연도(2021) + 다음 연도(2022) 딱 2개여야 한다. 2022는 예측 라운드라
    // 헤더에 "예측" 태그가 같이 붙어 접근성 이름이 "2022예측"이 된다(의도된 동작).
    expect(screen.getByRole('columnheader', { name: '2021' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /^2022/ })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: /^2023/ })).not.toBeInTheDocument()

    // 현재 연도 칸은 실제 보유 중인 현재가와 정확히 같아야 한다(재계산하지 않음)
    const rows = screen.getAllByRole('row')
    const a001Row = rows.find((r) => r.textContent.includes('테스트전자'))
    expect(a001Row.textContent).toContain('12,000')
  })

  it('대회 시작 전이면(current_round=0) 다음 라운드 모드가 비활성화된다', async () => {
    const u = userEvent.setup()
    render(<AdminSimulator {...makeProps()} />)
    await u.click(screen.getByText('다음 라운드만 (P_t → P_t+1)'))
    expect(generateBtn()).toBeDisabled()
  })

  it('[적용 + 발행] 클릭 시 백업 → 가격적용 → 속보발행 순서로 RPC가 불린다', async () => {
    const u = userEvent.setup()
    const props = makeNextRoundProps()
    render(<AdminSimulator {...props} />)

    await u.click(screen.getByText('다음 라운드만 (P_t → P_t+1)'))
    await u.click(generateBtn())
    await u.click(screen.getByText('다음 라운드 주가 적용 및 속보 발행'))
    await u.click(screen.getByRole('button', { name: '적용 + 발행' }))

    expect(props.actions.saveDataset).toHaveBeenCalledTimes(1)
    expect(props.actions.applySimulatedPrices).toHaveBeenCalledTimes(1)
    expect(props.actions.sendBroadcast).toHaveBeenCalledTimes(1)

    // admin_apply_simulated_prices는 stocks.prices를 통째로 교체한다(병합 아님) — 다음 연도만
    // 보내면 과거 연도가 전부 사라져 현재 화면이 보여줄 연도 가격까지 날아간다(전 종목이 거래정지로
    // 먹통이 되는 회귀 버그였다). 그래서 과거 연도 + 다음 연도를 전부 담아 보내야 한다.
    const applyPayload = props.actions.applySimulatedPrices.mock.calls[0][0]
    expect(Object.keys(applyPayload.A001).sort()).toEqual(['2021', '2022'])
    expect(applyPayload.A001['2021']).toBe(12_000) // 과거(현재) 연도 가격은 그대로 보존
    expect(props.refresh).toHaveBeenCalledTimes(1)
  })
})

describe('전체 궤적 차트 (과거 이력 + 다음 라운드 연결)', () => {
  it('현재 라운드 이전 실제가 전부 + 다음 라운드 예측치가 한 표·차트에 이어진다', async () => {
    const u = userEvent.setup()
    const props = makeProps({
      game: { current_round: 3, round_year_map: { 1: 2020, 2: 2021, 3: 2022, 4: 2023 }, total_rounds: 4, final_year: 2024 },
      stocks: [
        { id: 'A001', name: '테스트전자', sector: 'Tech', prices: { 2020: 9000, 2021: 10500, 2022: 12000 } },
        { id: 'A002', name: '테스트항공', sector: 'Air', prices: { 2020: 7000, 2021: 7500, 2022: 8000 } },
      ],
    })
    render(<AdminSimulator {...props} />)
    await u.click(screen.getByText('다음 라운드만 (P_t → P_t+1)'))
    await u.click(generateBtn())

    // 2020~2022(과거 실제가, 확정) + 2023(다음 라운드, 예측) 총 4개 열
    expect(screen.getByRole('columnheader', { name: '2020' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '2021' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '2022' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /^2023/ })).toBeInTheDocument()

    // 과거 연도 값은 재계산한 값이 아니라 실제 저장돼 있던 값 그대로여야 한다
    const rows = screen.getAllByRole('row')
    const a001Row = rows.find((r) => r.textContent.includes('테스트전자'))
    expect(a001Row.textContent).toContain('9,000')
    expect(a001Row.textContent).toContain('10,500')
    expect(a001Row.textContent).toContain('12,000')

    // 차트: 종목마다 예측점(2023) 딱 1개씩만 "예측" 스타일로 그려져야 한다
    const forecastPoints = document.querySelectorAll('.sim-point-forecast')
    expect(forecastPoints.length).toBe(2)
    // 확정 구간(실선)도 최소 하나는 그려져야 한다(2020→2021→2022 3점 연결)
    expect(document.querySelectorAll('.sim-line:not(.sim-line-forecast)').length).toBeGreaterThan(0)
    expect(document.querySelectorAll('.sim-line-forecast').length).toBeGreaterThan(0)
  })

  it('전체 라운드 일괄 모드에서는 전부 확정 스타일로 그려진다(예측점 없음)', async () => {
    const u = userEvent.setup()
    render(<AdminSimulator {...makeProps()} />)
    await u.click(generateBtn())
    expect(document.querySelectorAll('.sim-point-forecast').length).toBe(0)
  })
})

describe('거시 파라미터 세션 유지', () => {
  it('탭을 벗어났다 돌아와도(언마운트→재마운트) 슬라이더 값이 유지된다', () => {
    const { unmount } = render(<AdminSimulator {...makeProps()} />)
    fireEvent.change(screen.getByLabelText('기준금리 (%)'), { target: { value: '7.25' } })
    expect(screen.getByLabelText('기준금리 (%)')).toHaveValue(7.25)
    unmount() // Admin.jsx가 탭을 조건부 렌더라 실제로 이렇게 언마운트된다

    render(<AdminSimulator {...makeProps()} />)
    expect(screen.getByLabelText('기준금리 (%)')).toHaveValue(7.25)
  })

  it('[🔄 기본값으로 초기화]를 누르면 재마운트해도 기본값이 유지된다', () => {
    const { unmount } = render(<AdminSimulator {...makeProps()} />)
    fireEvent.change(screen.getByLabelText('기준금리 (%)'), { target: { value: '9' } })
    fireEvent.click(screen.getByText('🔄 기본값으로 초기화'))
    expect(screen.getByLabelText('기준금리 (%)')).toHaveValue(2)
    unmount()

    render(<AdminSimulator {...makeProps()} />)
    expect(screen.getByLabelText('기준금리 (%)')).toHaveValue(2)
  })
})

describe('시장 속보 생성', () => {
  it('generateMacroNews: 고금리·고물가면 긴축 헤드라인이 뜬다', () => {
    const items = generateMacroNews({ int_r: 5.5, inf: 9.0, unemp: 3, gdp: 3, sent: 50, fx: 1300, oil: 75 }, null, 2)
    expect(items.some((it) => it.headline.includes('긴축'))).toBe(true)
  })

  it('generateMacroNews: 아무 임계치도 안 넘으면 특이사항 없음 하나만 나온다', () => {
    const items = generateMacroNews({ int_r: 2, inf: 2, unemp: 3, gdp: 3, sent: 50, fx: 1300, oil: 75 }, null, 4)
    expect(items).toHaveLength(1)
    expect(items[0].headline).toContain('특이사항 없음')
  })

  it('generateMacroNews: 여러 임계치가 동시에 걸리면 후보가 여러 개 나온다', () => {
    const items = generateMacroNews({ int_r: 5.5, inf: 9.0, unemp: 3, gdp: 3, sent: 50, fx: 1600, oil: 130 }, null, 2)
    expect(items.length).toBeGreaterThanOrEqual(2)
  })

  it('스태그플레이션 프리셋을 고르고 다음 라운드를 생성하면 속보 미리보기에 긴축·유가 관련 문구가 뜬다', async () => {
    const u = userEvent.setup()
    render(<AdminSimulator {...makeNextRoundProps()} />)
    await u.click(screen.getByText('다음 라운드만 (P_t → P_t+1)'))
    await u.click(screen.getByText('스태그플레이션 위기'))
    await u.click(generateBtn())

    const headline = screen.getByLabelText('헤드라인')
    expect(headline.value).toMatch(/긴축|유가|환율/)
  })

  it('속보 헤드라인·본문은 발행 전 직접 고칠 수 있다', async () => {
    const u = userEvent.setup()
    render(<AdminSimulator {...makeNextRoundProps()} />)
    await u.click(screen.getByText('다음 라운드만 (P_t → P_t+1)'))
    await u.click(generateBtn())

    const headline = screen.getByLabelText('헤드라인')
    await u.clear(headline)
    await u.type(headline, '강사가 직접 쓴 속보')
    expect(headline).toHaveValue('강사가 직접 쓴 속보')
  })
})

const NEUTRAL_MACRO = { unemp: 3, gdp: 3, int_r: 2, inf: 2, sent: 50, fx: 1300, oil: 75 }

// generateBreakingNews는 이제 Gemini를 직접 호출하지 않는다 — Edge Function
// (supabase/functions/generate-breaking-news)을 actions.generateBreakingNews로 부를 뿐이라,
// 여기서는 네트워크/env를 흉내낼 필요 없이 그 액션만 목(mock)하면 된다.
function makeNewsActions(generateBreakingNewsImpl) {
  return { generateBreakingNews: vi.fn(generateBreakingNewsImpl) }
}

describe('Gemini 속보 서비스 (newsService.js) — Edge Function 경유', () => {
  it('Edge Function이 ok:false(키 없음/미배포)를 주면 규칙 기반으로 대체된다', async () => {
    const actions = makeNewsActions(async () => ({ ok: false, error: 'no_api_key' }))

    const result = await generateBreakingNews({ actions, macro: NEUTRAL_MACRO, prevMacro: null, round: 2, stocks: [] })

    expect(result.source).toBe('rule')
    expect(actions.generateBreakingNews).toHaveBeenCalledTimes(1)
  })

  it('Edge Function이 정상 응답하면 그 결과를 그대로 쓴다', async () => {
    const actions = makeNewsActions(async () => ({
      ok: true,
      headline: 'AI 헤드라인',
      body: 'AI 본문',
      sectors: ['금융'],
    }))

    const result = await generateBreakingNews({ actions, macro: NEUTRAL_MACRO, prevMacro: null, round: 2, stocks: [] })

    expect(result.source).toBe('gemini')
    expect(result.items[0].headline).toBe('AI 헤드라인')
    expect(result.items[0].sectors).toEqual(['금융'])
  })

  it('Edge Function 호출 자체가 실패(네트워크 예외)해도 예외 없이 규칙 기반으로 대체된다', async () => {
    const actions = makeNewsActions(async () => {
      throw new Error('network down')
    })

    const result = await generateBreakingNews({ actions, macro: NEUTRAL_MACRO, prevMacro: null, round: 2, stocks: [] })

    expect(result.source).toBe('rule')
    expect(result.error).toBeTruthy()
  })

  it('Edge Function이 ok:true인데 headline이 없으면(비정상 응답) 규칙 기반으로 대체된다', async () => {
    const actions = makeNewsActions(async () => ({ ok: true, headline: '' }))

    const result = await generateBreakingNews({ actions, macro: NEUTRAL_MACRO, prevMacro: null, round: 2, stocks: [] })

    expect(result.source).toBe('rule')
  })

  it('admin_secret은 actions.js가 자동으로 붙이므로 newsService는 macro/round/stocks만 넘긴다', async () => {
    const actions = makeNewsActions(async () => ({ ok: true, headline: 'h', body: 'b', sectors: [] }))
    await generateBreakingNews({ actions, macro: NEUTRAL_MACRO, prevMacro: null, round: 3, stocks: [{ id: 'A001', name: '테스트전자' }] })

    const arg = actions.generateBreakingNews.mock.calls[0][0]
    expect(arg.round).toBe(3)
    expect(arg.stocks).toEqual([{ id: 'A001', name: '테스트전자' }])
    expect(arg.p_admin_secret).toBeUndefined() // actions.js 쪽 책임이라 여기엔 없어야 한다
  })
})

describe('AI 속보 재생성 버튼 (UI 통합)', () => {
  it('Edge Function이 실패로 응답하면 규칙 기반으로 대체되고 AI 생성 배지는 안 뜬다', async () => {
    const u = userEvent.setup()
    const props = makeNextRoundProps({
      actions: {
        ...makeProps().actions,
        generateBreakingNews: vi.fn(async () => ({ ok: false, error: 'no_api_key' })),
      },
    })
    render(<AdminSimulator {...props} />)
    await u.click(screen.getByText('다음 라운드만 (P_t → P_t+1)'))
    await u.click(generateBtn())

    await u.click(screen.getByText('✨ AI 속보 재생성'))

    expect(props.actions.generateBreakingNews).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('✨ AI 생성')).not.toBeInTheDocument()
    expect(screen.getByLabelText('헤드라인').value.length).toBeGreaterThan(0)
  })

  it('Edge Function이 성공하면 AI 생성 배지가 뜨고 헤드라인·본문이 교체된다', async () => {
    const u = userEvent.setup()
    const props = makeNextRoundProps({
      actions: {
        ...makeProps().actions,
        generateBreakingNews: vi.fn(async () => ({ ok: true, headline: 'AI 특보', body: 'AI 본문', sectors: [] })),
      },
    })
    render(<AdminSimulator {...props} />)
    await u.click(screen.getByText('다음 라운드만 (P_t → P_t+1)'))
    await u.click(generateBtn())

    await u.click(screen.getByText('✨ AI 속보 재생성'))

    expect(await screen.findByText('✨ AI 생성')).toBeInTheDocument()
    expect(screen.getByLabelText('헤드라인')).toHaveValue('AI 특보')
    expect(screen.getByLabelText('본문')).toHaveValue('AI 본문')
  })
})

describe('섹터 색상 (다중 팔레트)', () => {
  it('sector 필드가 비어있어도 종목명 키워드로 서로 다른 업종·색이 배정된다', async () => {
    const u = userEvent.setup()
    const props = makeProps({
      stocks: [
        { id: 'B01', name: '현대보험' }, // sector 없음 → '보험' 키워드 → 금융
        { id: 'B02', name: '미래전자' }, // sector 없음 → '전자' 키워드 → IT/가전
      ],
    })
    render(<AdminSimulator {...props} />)
    await u.click(generateBtn())

    const chips = [...document.querySelectorAll('.sim-filters .sim-chip')]
    const labels = chips.map((c) => c.textContent)
    expect(labels).toContain('금융')
    expect(labels).toContain('IT/가전')

    const colorOf = (label) => chips.find((c) => c.textContent === label).style.getPropertyValue('--chip-color')
    expect(colorOf('금융')).not.toBe(colorOf('IT/가전'))
  })
})

describe('적용', () => {
  it('[이 가격 적용] → 확인 모달 → [적용] 클릭 시 RPC가 올바른 payload로 호출된다', async () => {
    const u = userEvent.setup()
    const props = makeProps()
    render(<AdminSimulator {...props} />)

    await u.click(generateBtn())
    await u.click(screen.getByText('이 가격 적용'))
    expect(screen.getByText('시뮬레이션 가격 적용')).toBeInTheDocument()

    await u.click(screen.getByRole('button', { name: '적용' }))

    expect(props.actions.applySimulatedPrices).toHaveBeenCalledTimes(1)
    const payload = props.actions.applySimulatedPrices.mock.calls[0][0]
    expect(Object.keys(payload).sort()).toEqual(['A001', 'A002'])
    expect(Object.keys(payload.A001).sort()).toEqual(['2021', '2022', '2023'])
    expect(payload.A001['2021']).toBeGreaterThan(0)
    expect(props.notify).toHaveBeenCalledWith(expect.stringContaining('반영'), 'gold')
    expect(props.refresh).toHaveBeenCalledTimes(1)
  })

  it('RPC가 실패로 응답하면 실패 메시지를 notify하고 refresh는 안 부른다', async () => {
    const u = userEvent.setup()
    const props = makeProps({
      actions: { applySimulatedPrices: vi.fn(async () => ({ ok: false, error: 'unauthorized' })) },
    })
    render(<AdminSimulator {...props} />)

    await u.click(generateBtn())
    await u.click(screen.getByText('이 가격 적용'))
    await u.click(screen.getByRole('button', { name: '적용' }))

    expect(props.notify).toHaveBeenCalledWith('ERR:unauthorized', 'down')
    expect(props.refresh).not.toHaveBeenCalled()
  })
})

describe('대회 시작 후 경고', () => {
  it('current_round > 0이면 경고 문구가 보인다', () => {
    const game = { current_round: 2, round_year_map: { 1: 2021, 2: 2022 }, final_year: 2023 }
    render(<AdminSimulator {...makeProps({ game })} />)
    expect(screen.getByText(/대회가 시작된 뒤입니다/)).toBeInTheDocument()
  })

  it('시작 전(current_round=0)이면 경고가 없다', () => {
    render(<AdminSimulator {...makeProps()} />)
    expect(screen.queryByText(/대회가 시작된 뒤입니다/)).not.toBeInTheDocument()
  })
})
