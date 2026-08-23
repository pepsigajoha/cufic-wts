// Gemini 프록시 Edge Function.
//
// [왜 이게 필요한가] Gemini API 키를 VITE_ 환경변수로 두면 브라우저 번들에 그대로 노출된다.
// Supabase anon key와 달리 이 키는 뒤에 RLS 같은 서버측 방어막이 없어서, 유출되면 즉시
// 누구나 그대로 갖다 쓸 수 있다. 그래서 키는 이 함수(서버 쪽 secret)에만 두고,
// 브라우저는 이 함수를 통해서만 Gemini를 호출한다.
//
// [인증] 이 프로젝트는 Supabase Auth를 안 쓴다(참가 코드/관리자 비밀번호로 자체 인증).
// 그래서 새 인증 경로를 만드는 대신, 이미 있는 admin_login RPC를 그대로 재사용해
// p_admin_secret이 맞는지 검사한다 — private.verify_admin()과 동일한 검사를 한 번 더
// 구현하지 않기 위함이다.
//
// 배포: supabase functions deploy generate-breaking-news
// 키 설정: supabase secrets set GEMINI_API_KEY=xxxxx
import { createClient } from 'jsr:@supabase/supabase-js@2'

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent'

// Supabase 대시보드가 아닌 다른 오리진(로컬 dev 서버 등)에서 오는 브라우저 호출을 허용한다.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

function buildPrompt(
  { macro, prevMacro, round, stocks, promptContext }: {
    macro: Record<string, number>
    prevMacro: Record<string, number> | null
    round: number
    stocks: Array<{ name?: string }>
    promptContext?: string
  },
) {
  const stockList = (stocks ?? [])
    .slice(0, 30)
    .map((s) => s.name)
    .filter(Boolean)
    .join(', ')
  const lines = [
    '너는 한국 청소년 경제 교육용 모의투자 게임의 시장 뉴스 작가야.',
    `${round}라운드 거시 지표 — 기준금리 ${macro.int_r}%, 실업률 ${macro.unemp}%, 물가상승률 ${macro.inf}%, ` +
      `GDP성장률 ${macro.gdp}%, 소비심리지수 ${macro.sent}, 원/달러 환율 ${macro.fx}원, 국제유가 ${macro.oil}달러.`,
  ]
  if (prevMacro) lines.push('직전 라운드 대비 눈에 띄게 달라진 지표가 있으면 자연스럽게 언급해.')
  if (stockList) lines.push(`게임에 등장하는 종목: ${stockList}`)
  if (promptContext) lines.push(`추가 지시: ${promptContext}`)
  lines.push(
    '이 지표를 바탕으로 생생한 한국어 경제 속보를 만들어줘. 과장이나 확정적인 예측 표현은 피하고,',
    '청소년이 읽기에 적절한 톤으로 써줘.',
    '반드시 아래 JSON 형식으로만 답해(다른 텍스트·마크다운 없이 순수 JSON 하나만):',
    '{"headline": "한 줄 헤드라인", "body": "2~3문장 본문", "sectors": ["영향받는 섹터", "..."]}',
  )
  return lines.join('\n')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'method_not_allowed' }, 405)
  }

  let payload: Record<string, unknown>
  try {
    payload = await req.json()
  } catch {
    return json({ ok: false, error: 'invalid_payload' }, 400)
  }

  const { p_admin_secret: adminSecret, macro, prevMacro = null, round, stocks = [], promptContext = '' } = payload as {
    p_admin_secret?: string
    macro?: Record<string, number>
    prevMacro?: Record<string, number> | null
    round?: number
    stocks?: Array<{ name?: string }>
    promptContext?: string
  }

  if (!macro || typeof round !== 'number') {
    return json({ ok: false, error: 'invalid_payload' }, 400)
  }

  // 기존 admin_login RPC를 그대로 재사용해 인증한다 — verify_admin을 여기서 다시 구현하지 않는다.
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseUrl || !anonKey) {
    return json({ ok: false, error: 'server_misconfigured' }, 500)
  }
  const supabase = createClient(supabaseUrl, anonKey)
  const { data: loginResult, error: loginError } = await supabase.rpc('admin_login', { p_admin_secret: adminSecret })
  if (loginError || !loginResult?.ok) {
    return json({ ok: false, error: 'unauthorized' }, 401)
  }

  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) {
    return json({ ok: false, error: 'no_api_key' })
  }

  try {
    const res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt({ macro, prevMacro, round, stocks, promptContext }) }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.9 },
      }),
    })
    if (!res.ok) {
      return json({ ok: false, error: `gemini_http_${res.status}` })
    }

    const data = await res.json()
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) return json({ ok: false, error: 'empty_response' })

    const parsed = JSON.parse(text)
    if (!parsed?.headline) return json({ ok: false, error: 'missing_headline' })

    return json({
      ok: true,
      headline: String(parsed.headline).trim(),
      body: typeof parsed.body === 'string' ? parsed.body.trim() : '',
      sectors: Array.isArray(parsed.sectors) ? parsed.sectors.filter((s: unknown) => typeof s === 'string') : [],
    })
  } catch (e) {
    return json({ ok: false, error: 'internal_error', detail: String(e) })
  }
})
