import { useEffect, useState } from 'react'
import { num, pct, dirOf } from '../format'
import { tickPrice } from '../realtimeTick'

// 종목 정렬 옵션. '기본'은 등록 순서(display_order)를 그대로 둔다.
const SORTS = [
  { key: 'default', label: '기본순' },
  { key: 'name', label: '이름순' },
  { key: 'price_desc', label: '가격 높은순' },
  { key: 'price_asc', label: '가격 낮은순' },
  { key: 'chg_desc', label: '등락률 높은순' },
  { key: 'chg_asc', label: '등락률 낮은순' },
]

export default function StockList({ stocks, selectedCode, onSelect, onOpenMy, tradingOpen, remainingMs, round }) {
  const [sort, setSort] = useState('default')

  // [연출 전용] 사용자가 "규칙 무시하고 좌측 목록 가격·등락률도 실시간 틱에 맞춰
  // 흔들리게" 명시적으로 요청해서, 여기서만 예외적으로 화면 표시값을 실시간 틱값으로
  // 바꾼다. 실제 체결가·평가금액·정렬 기준(sort는 여전히 s.chg 등 실제값 사용)엔
  // 전혀 영향을 주지 않는다 — 순수하게 이 컴포넌트가 렌더링하는 텍스트/색만 흔들린다.
  // Chart.jsx와 같은 이유로 로컬 타이머가 필요하다: 부모(App.jsx)는 1초에 한 번만
  // remainingMs를 갱신하므로, 그보다 훨씬 자주 다시 그려야 부드럽게 흔들려 보인다.
  const [, forceTick] = useState(0)
  useEffect(() => {
    if (!tradingOpen) return
    const id = setInterval(() => forceTick((n) => n + 1), 150)
    return () => clearInterval(id)
  }, [tradingOpen])

  // 상장 예정(preListed) 종목은 아직 목록에 없다 — 상장 라운드에 나타난다
  const rows = stocks.filter((s) => !s.preListed)
  if (sort === 'name') rows.sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  else if (sort === 'price_desc') rows.sort((a, b) => b.price - a.price)
  else if (sort === 'price_asc') rows.sort((a, b) => a.price - b.price)
  else if (sort === 'chg_desc') rows.sort((a, b) => b.chg - a.chg)
  else if (sort === 'chg_asc') rows.sort((a, b) => a.chg - b.chg)
  // default → filter가 유지한 등록 순서 그대로

  return (
    <aside className="col stocklist">
      <div className="listhead">
        <span>종목명</span>
        <select
          className="sort-sel"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          aria-label="종목 정렬"
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="rows">
        {rows.map((s) => {
          // [연출 전용] 실제 등락(dir)은 정렬·보유손익 등 다른 곳엔 그대로 s.chg를 쓰지만,
          // 이 행의 화면 텍스트/색만은 실시간 틱값으로 계산한다.
          const prevPrice = s.price - s.delta
          const livePrice =
            tradingOpen && !s.halted
              ? tickPrice({ officialPrice: s.price, seed: round ?? 0, stockId: s.code, remainingMs, sigma: 0.012 })
              : s.price
          const liveChg = prevPrice > 0 ? ((livePrice - prevPrice) / prevPrice) * 100 : 0
          const dir = dirOf(liveChg)
          return (
            <div
              key={s.code}
              className={'row' + (s.code === selectedCode ? ' on' : '')}
              onClick={() => onSelect(s.code)}
            >
              <div>
                <div className="nm">{s.name}</div>
                {s.holding > 0 && <div className="code">{s.holding}주 보유</div>}
              </div>
              <div className="pr">
                {s.halted ? (
                  <div className="halted-tag">거래정지</div>
                ) : (
                  <>
                    <div className={'price num ' + dir}>{num(livePrice)}</div>
                    <div className={'chg num ' + dir}>{pct(liveChg)}</div>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <button className="mybtn" onClick={onOpenMy}>
        MY · 내 계좌 / 보유종목
      </button>
    </aside>
  )
}
