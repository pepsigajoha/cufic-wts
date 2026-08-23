import { createClient } from '@supabase/supabase-js'

// anon key는 브라우저에 노출되는 게 정상이다. 원래 공개 전제이며,
// 실제 보안은 RLS(쓰기 정책 없음)와 RPC 내부 검증이 담당한다.
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  // 설정이 없으면 조용히 죽는 대신 무엇이 없는지 알린다
  console.error('[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 없습니다. .env를 확인하세요.')
}

export const supabase = createClient(url ?? '', key ?? '', {
  auth: { persistSession: false }, // 참가 코드로 신원을 관리한다. Supabase Auth를 쓰지 않는다.
})

/**
 * RPC 호출 공통 래퍼.
 *
 * 두 층의 실패를 구분한다:
 *   - 네트워크·서버 오류 → { ok:false, error:'network' } (토스트로 "연결이 불안정해요")
 *   - 함수가 돌려준 거부 → { ok:false, error:'insufficient_cash' } 등 (사유별 안내)
 * 어느 쪽이든 예외를 던지지 않는다. 화면이 통째로 죽으면 안 된다.
 */
export async function rpc(fn, args = {}) {
  try {
    const { data, error } = await supabase.rpc(fn, args)
    if (error) {
      console.error(`[rpc:${fn}]`, error.message)
      return { ok: false, error: 'network', detail: error.message }
    }
    // jsonb를 돌려주는 함수는 {ok,...}, table을 돌려주는 함수는 배열이다
    if (Array.isArray(data)) return { ok: true, rows: data }
    if (data && typeof data === 'object') return data
    return { ok: true, value: data }
  } catch (e) {
    console.error(`[rpc:${fn}]`, e)
    return { ok: false, error: 'network', detail: String(e) }
  }
}

/** select 공통 래퍼 */
export async function select(table, query = '*', filter) {
  try {
    let q = supabase.from(table).select(query)
    if (filter) q = filter(q)
    const { data, error } = await q
    if (error) {
      console.error(`[select:${table}]`, error.message)
      return { ok: false, error: 'network', detail: error.message }
    }
    return { ok: true, rows: data ?? [] }
  } catch (e) {
    console.error(`[select:${table}]`, e)
    return { ok: false, error: 'network', detail: String(e) }
  }
}

/**
 * Supabase Edge Function 호출 공통 래퍼. rpc()와 동일한 { ok, ... } 모양을 돌려준다.
 * 비밀 API 키(예: Gemini)를 브라우저에 노출시키지 않고 서버(Edge Function) 쪽에만
 * 두기 위한 경로 — VITE_ 접두사 env와 달리 이 키들은 번들에 절대 안 들어간다.
 */
export async function invokeFn(name, body = {}) {
  try {
    const { data, error } = await supabase.functions.invoke(name, { body })
    if (error) {
      console.error(`[fn:${name}]`, error.message)
      return { ok: false, error: 'network', detail: error.message }
    }
    return data
  } catch (e) {
    console.error(`[fn:${name}]`, e)
    return { ok: false, error: 'network', detail: String(e) }
  }
}

// 서버가 돌려주는 거부 사유 → 학생이 읽을 문장
export const ERROR_TEXT = {
  network: '연결이 불안정해요. 다시 시도해 주세요',
  unknown_code: '등록되지 않은 코드예요. 강사 선생님께 확인해 주세요',
  round_locked: '지금은 잠시 잠겨 있어요. 곧 다시 시도해 주세요',
  round_closed: '지금은 거래 시간이 아니에요',
  game_not_started: '아직 대회가 시작되지 않았어요',
  team_not_found: '조를 찾을 수 없어요',
  insufficient_cash: '주문가능 금액을 넘었어요',
  insufficient_shares: '보유한 수량보다 많이 팔 수 없어요',
  suspended: '거래가 정지된 종목이에요',
  stock_not_found: '없는 종목이에요',
  invalid_quantity: '수량을 확인해 주세요',
  invalid_side: '주문 방향이 올바르지 않아요',
  invalid_lines: '주문서 형식이 올바르지 않아요',
  already_last_round: '마지막 라운드입니다',
  unauthorized: '관리자 비밀번호가 맞지 않습니다',
  game_already_started: '대회가 시작된 뒤에는 바꿀 수 없습니다',
  code_exists: '이미 있는 참가 코드입니다',
  name_exists: '이미 쓰고 있는 이름이에요',
  bad_name: '이름은 2~12자로 입력해 주세요',
  team_not_found: '조를 찾을 수 없어요',
  invalid_payload: '데이터셋 파일 형식이 올바르지 않아요',
  not_found: '찾을 수 없어요',
}

export const errorText = (code) => ERROR_TEXT[code] ?? '문제가 생겼어요. 다시 시도해 주세요'
