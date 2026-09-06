// 힌트 헤드라인을 Gemini 로 다듬는다. impact·grade·related·round(=숫자·방향)는 절대 안 건드리고
// **문장만** 바꾼다. 키가 없거나 실패하면 deriveRoundHints 가 넣어둔 템플릿 헤드라인을 그대로 둔다.

import { callGemini, hasGeminiKey } from './gemini'

function buildPrompt(items) {
  return [
    '너는 한국 청소년 경제 교육용 모의투자 게임의 힌트 문구 작가야.',
    '아래 각 힌트에 대해, 방향(호재/악재)을 은근히 암시하되 **확정적으로 말하지 않는**',
    '한 줄 헤드라인을 써줘. 종목명을 직접 넣어도 되고 돌려 말해도 돼. 등급이 높을수록(S가 최상)',
    '더 강하고 구체적인 뉘앙스로.',
    '',
    ...items.map(
      (it, i) =>
        `${i + 1}. 종목="${it.name}" 방향=${it.impact === 'up' ? '호재(오를 것)' : '악재(내릴 것)'} 등급=${it.grade}`,
    ),
    '',
    `반드시 아래 JSON 형식으로만 답해(설명·마크다운 없이). 배열 길이는 정확히 ${items.length}:`,
    '{"headlines": ["1번 헤드라인", "2번 헤드라인", ...]}',
  ].join('\n')
}

/**
 * @param {Array<{grade:string, round:number, impact:'up'|'down', related_stock_ids:string[], headline:string}>} hints
 * @param {Record<string,string>} namesById  종목 id → 이름
 * @returns {Promise<{ hints: typeof hints, source: 'gemini'|'template', error?: string }>}
 */
export async function refineHintHeadlines(hints = [], namesById = {}) {
  if (hints.length === 0 || !hasGeminiKey()) return { hints, source: 'template' }
  const items = hints.map((h) => ({
    name: namesById[h.related_stock_ids?.[0]] ?? h.related_stock_ids?.[0] ?? '해당 종목',
    impact: h.impact,
    grade: h.grade,
  }))
  try {
    const out = await callGemini(buildPrompt(items), { json: true, temperature: 0.85 })
    const lines = out?.headlines
    if (!Array.isArray(lines) || lines.length !== hints.length) throw new Error('headline_count_mismatch')
    return {
      hints: hints.map((h, i) => ({
        ...h,
        headline: String(lines[i] ?? h.headline).trim() || h.headline,
      })),
      source: 'gemini',
    }
  } catch (e) {
    console.error('[hintService] Gemini 실패, 템플릿 헤드라인 유지:', e)
    return { hints, source: 'template', error: String(e.message ?? e) }
  }
}
