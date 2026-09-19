import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./supabase', () => ({
  rpc: vi.fn(),
  select: vi.fn(),
}))

import { rpc, select } from './supabase'
import { getJoinConfig, loadTeam, quickJoin } from './auth'

describe('QR 간편 입장', () => {
  beforeEach(() => {
    localStorage.clear()
    rpc.mockReset()
    select.mockReset()
  })

  it('관리자가 켠 QR 입장은 게임 시작 전 로그인 화면에만 노출한다', async () => {
    select.mockResolvedValue({
      ok: true,
      rows: [{ join_mode: 'code', quick_join_enabled: true, current_round: 0 }],
    })

    await expect(getJoinConfig()).resolves.toEqual({ mode: 'code', quickJoinEnabled: true })

    select.mockResolvedValue({
      ok: true,
      rows: [{ join_mode: 'code', quick_join_enabled: true, current_round: 1 }],
    })
    await expect(getJoinConfig()).resolves.toEqual({ mode: 'code', quickJoinEnabled: false })
  })

  it('서버가 만든 랜덤 조를 저장해 새로고침 뒤에도 재접속한다', async () => {
    rpc.mockResolvedValue({
      ok: true,
      team_id: 'team-1',
      code: 'QR-A1B2C3D4',
      name: '용감한호랑이27',
    })

    const result = await quickJoin()

    expect(rpc).toHaveBeenCalledWith('quick_join_team')
    expect(result).toEqual({
      ok: true,
      team: { id: 'team-1', code: 'QR-A1B2C3D4', name: '용감한호랑이27' },
      created: true,
    })
    expect(loadTeam()).toBe('QR-A1B2C3D4')
  })

  it('관리자가 꺼둔 상태면 학생이 이해할 안내를 돌려준다', async () => {
    rpc.mockResolvedValue({ ok: false, error: 'quick_join_disabled' })

    const result = await quickJoin()

    expect(result.ok).toBe(false)
    expect(result.code).toBe('quick_join_disabled')
    expect(result.error).toContain('간편 입장이 닫혀')
    expect(loadTeam()).toBe(null)
  })
})
