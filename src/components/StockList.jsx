import { useState } from 'react'
import { num, pct, dirOf } from '../format'
import { execPriceOf } from '../gameData'

// 종목 정렬 옵션. '기본'은 등록 순서(display_order)를 그대로 둔다.
const SORTS = [
  { key: 'default', label: '기본순' },
  { key: 'name', label: '이름순' },
  { key: 'price_desc', label: '가격 높은순' },
  { key: 'price_asc', label: '가격 낮은순' },
  { key: 'chg_desc', label: '등락률 높은순' },
  { key: 'chg_asc', label: '등락률 낮은순' },
]

// 1주 = 5 거래스텝. 스텝은 ≈2.4초마다 넘어가므로, 미시적 틱마다 색이 깜빡이지 않게
// 등락률·플래시의 기준을 "주(5스텝)"로 잡는다.
const WEEK_STEPS = 5

export default function StockList({ stocks, selectedCode, onSelect, onOpenMy, tradingOpen, stepIndex = 251 }) {
  const [sort, setSort] = useState('default')

  // 상장 예정(preListed) 종목은 아직 목록에 없다 — 상장 라운드에 나타난다
  const rows = stocks.filter((s) => !s.preListed)
  if (sort === 'name') rows.sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  else if (sort === 'price_desc') rows.sort((a, b) => b.price - a.price)
  else if (sort === 'price_asc') rows.sort((a, b) => a.price - b.price)
  else if (sort === 'chg_desc') rows.sort((a, b) => b.chg - a.chg)
  else if (sort === 'chg_asc') rows.sort((a, b) => a.chg - b.chg)
  // default → filter가 유지한 등록 순서 그대로

  // 지금이 몇 번째 "주"인가 — 5스텝마다 1 증가. 플래시 재생의 트리거로 쓴다.
  const weekIdx = Math.floor(Math.max(0, stepIndex) / WEEK_STEPS)

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
          const live = tradingOpen && !s.halted
          // 현재 장중 체결가(OrderSheet·차트 팁과 같은 값) + 1주(5스텝) 전 기준가
          const cur = live ? execPriceOf(s, stepIndex) : s.price
          const wkBase = live ? execPriceOf(s, stepIndex - WEEK_STEPS) : 0
          // 주간 등락률 = (현재가 − 1주 전 기준가) / 1주 전 기준가. 비거래 중엔 연간(YoY) 등락률.
          const chg = live ? (wkBase > 0 ? ((cur - wkBase) / wkBase) * 100 : 0) : s.chg
          const dir = dirOf(chg)
          // 플래시는 "주가 넘어갈 때(5스텝 경계)" 또는 "주간 추세 방향이 뒤집힐 때"만 재생.
          // key가 바뀌면 .pr이 리마운트되며 CSS 애니메이션이 한 번 재생된다 — 그 사이엔
          // 숫자만 갱신되고(리마운트 없음) 색이 2.4초마다 깜빡이지 않는다.
          const flashKey = live ? `${weekIdx}:${dir}` : 'static'
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
              {s.halted ? (
                <div className="pr">
                  <div className="halted-tag">거래정지</div>
                </div>
              ) : (
                <div key={flashKey} className={'pr ' + dir + (live ? ' wk-flash' : '')}>
                  <div className={'price num ' + dir}>{num(cur)}</div>
                  <div className={'chg num ' + dir}>{pct(chg)}</div>
                </div>
              )}
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
