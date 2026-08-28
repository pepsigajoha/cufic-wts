import { generateMacroNews } from './macroNews'

/**
 * Gemini로 시장 속보를 생성한다.
 *
 * [보안] Gemini API 키는 브라우저에 절대 두지 않는다 — Supabase Edge Function
 * (supabase/functions/generate-breaking-news)이 서버 쪽 secret으로만 갖고 있고,
 * 여기서는 actions.generateBreakingNews(...)로 그 함수를 호출할 뿐이다. 관리자 인증도
 * 기존 admin_login RPC를 Edge Function 안에서 그대로 재사용한다(새 인증 경로를 안 만든다).
 *
 * Edge Function이 배포 안 됐거나, 키가 없거나, 호출·파싱이 실패하면 예외를 던지지 않고
 * 조용히 macroNews.js의 규칙 기반 생성기로 대체한다(source 필드로 어느 쪽인지 구분).
 *
 * @returns {Promise<{ source: 'gemini'|'rule', items: Array, error?: string }>}
 */
export async function generateBreakingNews({ actions, macro, prevMacro = null, round, stocks = [], promptContext = '' }) {
  try {
    const r = await actions.generateBreakingNews({
      macro,
      prevMacro,
      round,
      stocks: (stocks ?? []).map((s) => ({ id: s.id, name: s.name })), // 서버로는 필요한 필드만
      promptContext,
    })
    if (!r.ok) throw new Error(r.error ?? 'edge_function_failed')
    if (!r.headline) throw new Error('Edge Function 응답에 headline이 없습니다')

    return {
      source: 'gemini',
      items: [
        {
          key: 'gemini',
          headline: r.headline,
          body: r.body ?? '',
          sectors: Array.isArray(r.sectors) ? r.sectors : [],
          impact: 'mixed',
        },
      ],
    }
  } catch (e) {
    console.error('[newsService] Edge Function 호출 실패, 규칙 기반으로 대체합니다:', e)
    return { source: 'rule', items: generateMacroNews(macro, prevMacro, round), error: String(e.message ?? e) }
  }
}
