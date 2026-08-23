import { rpc, select } from './supabase'

// 조별 코드 로그인. 검증은 서버(login_team RPC)가 한다.
const TEAM_KEY = 'wts-team'

/** 입장 방식 조회('code' | 'open'). 로그인 전 화면 분기용. game_state는 공개 읽기. */
export async function getJoinMode() {
  const r = await select('game_state', 'join_mode', (q) => q.eq('id', 1))
  if (r.ok && r.rows[0]?.join_mode) return r.rows[0].join_mode
  return 'code'
}

/**
 * 자율 입장(open 모드) — 닉네임 + 공용 게임 PIN으로 조 생성/재접속.
 * PIN은 강사가 발급해 전달한 "게임 하나에 공용 PIN 하나". 신규·재접속 모두 같은 PIN을 쓴다.
 * @returns 신규: {ok, team, created} · 재접속: {ok, team} · 실패: {ok:false, error, code}
 */
export async function join(name, pin) {
  const nm = String(name || '').trim()
  if (nm.length < 2 || nm.length > 12) {
    return { ok: false, error: '닉네임은 2~12자로 입력해 주세요.' }
  }
  const r = await rpc('join_team', { p_name: nm, p_pin: pin ?? null })
  if (!r.ok) {
    const MSG = {
      join_disabled: '지금은 자율 입장을 받지 않아요.',
      bad_name: '닉네임은 2~12자로 입력해 주세요.',
      no_game_pin: '아직 입장 PIN이 준비되지 않았어요. 강사 선생님께 확인해 주세요.',
      need_pin: '입장 PIN을 입력해 주세요.',
      wrong_pin: '입장 PIN이 틀렸어요. 강사 선생님이 알려준 PIN을 확인해 주세요.',
      join_closed: '대회가 시작돼 새 입장은 마감됐어요. 기존 닉네임+PIN으로만 들어올 수 있어요.',
    }
    return { ok: false, error: MSG[r.error] || '연결이 불안정해요. 다시 시도해 주세요.', code: r.error }
  }
  try {
    localStorage.setItem(TEAM_KEY, r.code)
  } catch {
    // 저장 실패해도 세션 내 입장은 허용
  }
  return { ok: true, team: { id: r.team_id, code: r.code, name: r.name }, created: !!r.created }
}

export function loadTeam() {
  try {
    return localStorage.getItem(TEAM_KEY) || null
  } catch {
    return null
  }
}

/**
 * 참가 코드로 입장. 서버에 실제로 있는 코드인지 확인한다.
 * @returns {Promise<{ok: true, team: {code, name, id}} | {ok: false, error: string}>}
 */
export async function login(code) {
  const trimmed = String(code || '').trim()
  if (!trimmed) return { ok: false, error: '참가 코드를 입력해 주세요.' }

  const r = await rpc('login_team', { p_code: trimmed })
  if (!r.ok) {
    return {
      ok: false,
      error:
        r.error === 'unknown_code'
          ? '등록되지 않은 코드예요. 강사 선생님께 확인해 주세요.'
          : '연결이 불안정해요. 다시 시도해 주세요.',
    }
  }

  try {
    localStorage.setItem(TEAM_KEY, r.code)
  } catch {
    // 저장 실패해도 세션 내 입장은 허용
  }
  return { ok: true, team: { id: r.team_id, code: r.code, name: r.name } }
}

/** 새로고침 시 자동 재로그인. 저장된 코드가 아직 유효한지 서버에 확인한다. */
export async function restore() {
  const code = loadTeam()
  if (!code) return { ok: false, error: 'no_saved_code' }
  const r = await rpc('login_team', { p_code: code })
  if (!r.ok) {
    // 조가 삭제됐거나 코드가 바뀌었으면 저장된 것을 지운다
    if (r.error === 'unknown_code') logout()
    return { ok: false, error: r.error }
  }
  return { ok: true, team: { id: r.team_id, code: r.code, name: r.name } }
}

export function logout() {
  try {
    localStorage.removeItem(TEAM_KEY)
  } catch {
    // 무시
  }
}
