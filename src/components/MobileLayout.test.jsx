import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import StudentWorkspace from './StudentWorkspace'
import OrderSheet from './OrderSheet'
import StockList from './StockList'
import Modal from './Modal'
import AdminNavigation from '../admin/AdminNavigation'
import AdminHeader from '../admin/AdminHeader'

vi.mock('../supabase', () => ({ errorText: (s) => s }))
afterEach(() => { cleanup(); vi.useRealTimers() })

const stock = { code: 'A', name: '한빛반도체', price: 10000, holding: 0, avgPrice: 0, chg: 0 }

describe('모바일 화면 이동', () => {
  it('차트·주문 화면을 오가도 주문 수량을 보존한다', () => {
    function Student() {
      const [view, setView] = useState('order')
      return <StudentWorkspace view={view} onViewChange={setView} mode="spot" stock={stock} cash={1000000} tradingOpen onOpenMy={vi.fn()}>
        <OrderSheet stock={stock} stocks={[stock]} cash={1000000} tradingOpen started onOrder={vi.fn()} />
      </StudentWorkspace>
    }
    const { container } = render(<Student />)
    fireEvent.click(screen.getByRole('button', { name: '50%' }))
    expect(screen.getByLabelText('매수 수량')).toHaveValue('50')
    fireEvent.click(screen.getByRole('button', { name: '종목 상세로 돌아가기' }))
    expect(container.querySelector('.app')).toHaveClass('mobile-view-analysis')
    fireEvent.click(screen.getByRole('button', { name: '종목 목록으로 돌아가기' }))
    expect(container.querySelector('.app')).toHaveClass('mobile-view-stocks')
    fireEvent.click(screen.getByRole('button', { name: '차트·근거', exact: true }))
    expect(container.querySelector('.app')).toHaveClass('mobile-view-analysis')
    fireEvent.click(screen.getByRole('button', { name: '매수하기', exact: true }))
    expect(container.querySelector('.app')).toHaveClass('mobile-view-order')
    expect(screen.getByLabelText('매수 수량')).toHaveValue('50')
    fireEvent.click(screen.getByRole('button', { name: '종목 목록', exact: true }))
    expect(container.querySelector('.app')).toHaveClass('mobile-view-stocks')
  })

  it('예금 모드는 종목 대신 금리·가입 화면과 내 자산을 제공한다', () => {
    const onOpenMy = vi.fn()
    const { container } = render(<StudentWorkspace view="stocks" mode="savings" stock={stock} cash={100} onViewChange={vi.fn()} onOpenMy={onOpenMy} />)
    expect(container.querySelector('.app')).toHaveClass('mobile-view-order')
    expect(screen.queryByRole('button', { name: '종목', exact: true })).toBeNull()
    expect(screen.getByRole('button', { name: '가입·내 예금' })).toHaveAttribute('aria-current', 'page')
    fireEvent.click(screen.getByRole('button', { name: '내 자산' }))
    expect(onOpenMy).toHaveBeenCalledOnce()
  })

  it('관리 메뉴에서 모든 화면에 접근하고 선택을 전달한다', () => {
    const onChange = vi.fn()
    render(<AdminNavigation tab="progress" onChange={onChange} />)
    const menu = screen.getByRole('combobox', { name: '관리 화면 선택' })
    expect(menu.querySelectorAll('option')).toHaveLength(11)
    fireEvent.change(menu, { target: { value: 'system' } })
    expect(onChange).toHaveBeenCalledWith('system')
  })

  it('검색·보유 필터가 상장 예정 종목을 노출하지 않는다', () => {
    const { container } = render(<StockList stocks={[
      stock,
      { ...stock, code: 'B', name: '한빛게임', holding: 2 },
      { ...stock, code: 'C', name: '한빛신규', preListed: true },
    ]} selectedCode="A" onSelect={vi.fn()} />)
    fireEvent.change(screen.getByRole('searchbox', { name: '종목 검색' }), { target: { value: '한빛' } })
    expect(container.querySelectorAll('.row')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: '내 보유종목' }))
    expect(container.querySelector('.nm')).toHaveTextContent('한빛게임')
    expect(container.querySelectorAll('.row')).toHaveLength(1)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '없는회사' } })
    expect(container.querySelectorAll('.row')).toHaveLength(0)
    expect(screen.getByText(/검색한 종목이 없어요/)).toBeInTheDocument()
  })

  it('상세 화면에서 선택한 매도 방향을 주문에 전달하고 방향을 바꾸면 수량을 비운다', () => {
    function Student() {
      const [view, setView] = useState('analysis')
      const [side, setSide] = useState('buy')
      const held = { ...stock, holding: 100 }
      return <StudentWorkspace view={view} onViewChange={setView} mode="spot" stock={held} cash={1000000} tradingOpen onOrderSide={setSide}>
        <OrderSheet stock={held} stocks={[held]} side={side} onSideChange={setSide} cash={1000000} tradingOpen started onOrder={vi.fn()} />
      </StudentWorkspace>
    }
    render(<Student />)
    fireEvent.click(screen.getByRole('button', { name: '매도하기' }))
    expect(screen.getByRole('tab', { name: '매도' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('button', { name: '50%' }))
    expect(screen.getByLabelText('매도 수량')).toHaveValue('50')
    fireEvent.click(screen.getByRole('tab', { name: '매수' }))
    expect(screen.getByLabelText('매수 수량')).toHaveValue('0')
  })
})

describe('모바일 상태·팝업', () => {
  it('관리자 헤더는 일시정지 시각에서 타이머와 거래 상태를 고정한다', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-18T03:00:00Z'))
    render(<AdminHeader game={{ current_round: 1, total_rounds: 5, round_ends_at: '2026-09-18T03:05:00Z', round_paused_at: '2026-09-18T03:00:00Z', round_duration_seconds: 600 }} />)
    expect(screen.getByRole('timer')).toHaveTextContent('5:00')
    act(() => vi.advanceTimersByTime(120000))
    expect(screen.getByRole('timer')).toHaveTextContent('5:00')
    expect(screen.getByText('일시정지')).toBeInTheDocument()
    expect(screen.queryByText('거래 열림')).toBeNull()
  })

  it('팝업이 숨겨지거나 변형된 패널 밖에 열리고 닫으면 포커스가 돌아온다', () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return <div style={{ transform: 'translateY(0)' }}>
        <button onClick={() => setOpen(true)}>열기</button>
        <Modal open={open} onClose={() => setOpen(false)} title="주문 확인"><button>확인</button></Modal>
      </div>
    }
    const { container } = render(<Harness />)
    const trigger = screen.getByText('열기')
    trigger.focus()
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: '주문 확인' })
    expect(container.contains(dialog)).toBe(false)
    expect(dialog.contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
