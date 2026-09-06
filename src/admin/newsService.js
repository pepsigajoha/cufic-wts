import { generateMacroNews } from './macroNews'
import { callGemini, hasGeminiKey } from './gemini'

// 프롬프트 — Edge Function(supabase/functions/generate-breaking-news)의 buildPrompt 와 같은 뼈대에
// "이번 라운드 종목별 등락률"을 추가한다. 그래야 시황 문장이 실제 가격 움직임을 설명한다.
function buildNewsPrompt({ macro, prevMacro, round, stocks = [], moves = [], promptContext = '' }) {
  const stockList = (stocks ?? []).slice(0, 30).map((s) => s.name).filter(Boolean).join(', ')
  const moveList = (moves ?? [])
    .filter((m) => m && Number.isFinite(m.pct))
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
    .slice(0, 12)
    .map((m) => `${m.name} ${m.pct > 0 ? '+' : ''}${m.pct.toFixed(1)}%`)
    .join(', ')
  const lines = [
    '너는 한국 청소년 경제 교육용 모의투자 게임의 시장 뉴스 작가야.',
    `${round}라운드 거시 지표 — 기준금리 ${macro.int_r}%, 실업률 ${macro.unemp}%, 물가상승률 ${macro.inf}%, ` +
      `GDP성장률 ${macro.gdp}%, 소비심리지수 ${macro.sent}, 원/달러 환율 ${macro.fx}원, 국제유가 ${macro.oil}달러.`,
  ]
  if (prevMacro) lines.push('직전 라운드 대비 눈에 띄게 달라진 지표가 있으면 자연스럽게 언급해.')
  if (moveList) lines.push(`이번 라운드 주요 종목 등락: ${moveList}. 이 움직임과 어울리는 배경을 만들어줘.`)
  if (stockList) lines.push(`게임에 등장하는 종목: ${stockList}`)
  if (promptContext) lines.push(`추가 지시: ${promptContext}`)
  lines.push(
    '이 정보를 바탕으로 생생한 한국어 경제 속보를 만들어줘. 과장이나 확정적인 예측 표현은 피하고,',
    '청소년이 읽기에 적절한 톤으로 써줘.',
    '반드시 아래 JSON 형식으로만 답해(다른 텍스트·마크다운 없이 순수 JSON 하나만):',
    '{"headline": "한 줄 헤드라인", "body": "2~3문장 본문", "sectors": ["영향받는 섹터", "..."]}',
  )
  return lines.join('\n')
}

function toItems(r) {
  return [
    {
      key: 'gemini',
      headline: r.headline,
      body: typeof r.body === 'string' ? r.body : '',
      sectors: Array.isArray(r.sectors) ? r.sectors.filter((s) => typeof s === 'string') : [],
      impact: 'mixed',
    },
  ]
}

/**
 * Gemini로 시장 속보를 생성한다.
 *
 * 우선순위: (1) 관리자가 넣은 Gemini 키가 있으면 브라우저에서 직접 호출
 *          (2) 없으면 Edge Function(actions.generateBreakingNews) — 서버 secret 경로
 *          (3) 둘 다 실패하면 macroNews.js 규칙 기반 생성기
 * source 필드로 어느 쪽인지 구분한다.
 *
 * @returns {Promise<{ source: 'gemini'|'rule', items: Array, error?: string }>}
 */
export async function generateBreakingNews({
  actions,
  macro,
  prevMacro = null,
  round,
  stocks = [],
  moves = [],
  promptContext = '',
}) {
  const slim = (stocks ?? []).map((s) => ({ id: s.id, name: s.name }))

  // (1) 브라우저 직접 호출
  if (hasGeminiKey()) {
    try {
      const r = await callGemini(
        buildNewsPrompt({ macro, prevMacro, round, stocks: slim, moves, promptContext }),
        { json: true },
      )
      if (!r?.headline) throw new Error('missing_headline')
      return { source: 'gemini', items: toItems(r) }
    } catch (e) {
      console.error('[newsService] 직접 호출 실패, Edge Function 시도:', e)
    }
  }

  // (2) Edge Function
  try {
    const r = await actions.generateBreakingNews({ macro, prevMacro, round, stocks: slim, promptContext })
    if (!r.ok) throw new Error(r.error ?? 'edge_function_failed')
    if (!r.headline) throw new Error('Edge Function 응답에 headline이 없습니다')
    return { source: 'gemini', items: toItems(r) }
  } catch (e) {
    console.error('[newsService] Edge Function 호출 실패, 규칙 기반으로 대체합니다:', e)
    return { source: 'rule', items: generateMacroNews(macro, prevMacro, round), error: String(e.message ?? e) }
  }
}
