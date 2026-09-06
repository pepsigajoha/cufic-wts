// 관리자가 자기 Gemini 키를 직접 넣어 브라우저에서 바로 호출하는 경로.
//
// [보안] 키를 번들에 넣지 않는다(그건 학생 전원에게 배포하는 것). 대신 관리자가
// 비번으로 잠긴 화면에서 자기 키를 붙여넣고, 그 키는 **이 관리자 브라우저의
// sessionStorage 에만** 산다(탭 닫으면 사라짐). 파일·git·서버·다른 사용자에게 안 간다.
// Google generativelanguage API 는 키 쿼리파라미터 + 브라우저 직접 호출을 허용한다.
//
// 우선순위: 이 키 있으면 직접 호출 → 없으면 Edge Function → 둘 다 없으면 규칙 템플릿.

const KEY_STORAGE = 'wts-gemini-key'
const MODEL_STORAGE = 'wts-gemini-model'
// Google이 몇 달마다 모델을 갈아치운다(1.5→2.0→3.6…). 404가 나면 아래 기본값을 바꾸거나
// 관리자 화면 [모델] 칸에 새 이름을 넣으면 된다(sessionStorage에 저장).
const DEFAULT_MODEL = 'gemini-3.6-flash'
const endpointFor = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`

export function getGeminiModel() {
  try {
    return sessionStorage.getItem(MODEL_STORAGE) || DEFAULT_MODEL
  } catch {
    return DEFAULT_MODEL
  }
}

export function setGeminiModel(m) {
  try {
    if (m && m.trim() && m.trim() !== DEFAULT_MODEL) sessionStorage.setItem(MODEL_STORAGE, m.trim())
    else sessionStorage.removeItem(MODEL_STORAGE)
  } catch {
    /* 무시 */
  }
}

export function getGeminiKey() {
  try {
    return sessionStorage.getItem(KEY_STORAGE) || ''
  } catch {
    return ''
  }
}

export function setGeminiKey(k) {
  try {
    if (k) sessionStorage.setItem(KEY_STORAGE, k.trim())
    else sessionStorage.removeItem(KEY_STORAGE)
  } catch {
    /* 무시 */
  }
}

export function clearGeminiKey() {
  setGeminiKey('')
}

export function hasGeminiKey() {
  return !!getGeminiKey()
}

/**
 * 프롬프트 하나를 Gemini 에 보내고 JSON(또는 텍스트)을 돌려받는다.
 * 키가 없거나 호출·파싱이 실패하면 throw — 호출부가 폴백을 처리한다.
 * @param {string} prompt
 * @param {{ json?: boolean, temperature?: number }} [opts]
 * @returns {Promise<any>}  json:true 면 파싱된 객체, 아니면 문자열
 */
export async function callGemini(prompt, { json = true, temperature = 0.9 } = {}) {
  const key = getGeminiKey()
  if (!key) throw new Error('no_gemini_key')

  const res = await fetch(`${endpointFor(getGeminiModel())}?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature,
        ...(json ? { responseMimeType: 'application/json' } : {}),
      },
    }),
  })
  if (!res.ok) {
    // Google이 주는 에러 본문(모델 없음·키 무효 등)을 그대로 실어 준다
    const detail = await res.text().catch(() => '')
    const msg = detail.match(/"message"\s*:\s*"([^"]+)"/)?.[1] ?? detail.slice(0, 200)
    throw new Error(`gemini_http_${res.status}${msg ? ` — ${msg}` : ''}`)
  }

  const data = await res.json()
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('gemini_empty_response')
  if (!json) return text
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('gemini_bad_json')
  }
}
