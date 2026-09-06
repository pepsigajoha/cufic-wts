// 라운드(=1년=252거래일)를 4분기(63일씩)로 나눈다. 분기 경계에서 drift·변동성만
// 교체되고 가격은 직전 종가(S_{t-1})를 그대로 이어간다 — 수직 점프·인위적 갭 없음.
// (연속성은 priceSim의 sim.price가 매 스텝 이어받으므로 구조적으로 보장된다.)
//
// 엔진(priceSim.js)·실시간 훅(App.jsx)·미리보기(AdminSimulator.jsx)가 전부 이 파일의
// 경계값과 헬퍼를 참조한다. "63" 같은 분기 상수를 다른 데서 다시 쓰지 않는다.

import { STEPS_PER_YEAR } from './chart'

/** 한 분기의 거래일 수. 252 / 4 = 63. */
export const QUARTER_LEN = STEPS_PER_YEAR / 4

if (!Number.isInteger(QUARTER_LEN)) {
  // STEPS_PER_YEAR가 4로 나눠떨어지지 않게 바뀌면 분기 경계 정의부터 다시 잡아야 한다.
  throw new Error(`STEPS_PER_YEAR(${STEPS_PER_YEAR})는 4로 나눠떨어져야 합니다`)
}

/** 각 분기가 시작하는 거래일(1-인덱스). [1, 64, 127, 190]. */
export const QUARTER_STARTS = [0, 1, 2, 3].map((q) => q * QUARTER_LEN + 1)

/**
 * 거래일(1..252) → 분기 번호(1..4). 범위를 벗어나면 가까운 쪽으로 클램프.
 * @param {number} day
 * @returns {1|2|3|4}
 */
export function quarterAt(day) {
  const d = Math.floor(Number(day) || 0)
  const q = Math.floor((d - 1) / QUARTER_LEN) + 1
  return /** @type {1|2|3|4} */ (Math.min(4, Math.max(1, q)))
}

/**
 * 스텝 인덱스(0..251 — chart.roundStepIndex 산출물) → 분기 번호(1..4).
 * @param {number} stepIdx
 * @returns {1|2|3|4}
 */
export function quarterOfStep(stepIdx) {
  return quarterAt(Math.floor(Number(stepIdx) || 0) + 1)
}

/**
 * 스텝(0..251) → 가상 월(1..12). 21거래일 = 1개월이라 분기(63일=3개월)와 정확히 맞는다.
 * 헤더에 "Q2 · 5월"처럼 표시할 때 쓴다(별도 기준일자 없이 진행률만으로).
 * @param {number} stepIdx
 * @returns {number}
 */
export function monthOfStep(stepIdx) {
  const i = Math.max(0, Math.min(STEPS_PER_YEAR - 1, Math.floor(Number(stepIdx) || 0)))
  return Math.min(12, Math.floor(i / (STEPS_PER_YEAR / 12)) + 1)
}

/**
 * 그 거래일이 어떤 분기의 첫날인가(1/64/127/190에서만 true) — 분기 이벤트 발화 조건.
 * @param {number} day
 * @returns {boolean}
 */
export function isQuarterStart(day) {
  return QUARTER_STARTS.includes(Math.floor(Number(day) || 0))
}

// 분기 config의 shape·기본값·검증은 관리자 모듈에 있다(거시 7요인 기본값이 엔진에 있어서):
//   src/admin/quarterConfig.js — defaultQuarterConfigs() · isValidQuarterConfigs()
// 이 파일(학생 화면도 import)은 순수 기하 헬퍼만 둔다 — 엔진을 학생 번들로 끌어오지 않기 위해.

/**
 * @typedef {Object} QuarterConfig
 * @property {1|2|3|4} quarter   분기 번호
 * @property {{int_r:number, gdp:number, unemp:number, inf:number, sent:number, fx:number, oil:number}} macro
 *           그 분기 63일 동안 쓸 거시 7요인. 분기 경계에서 이 값으로 통째 교체되고, step()의
 *           Δ(shock)/절대치(gravity) 로직이 위기·호황을 만든다(별도 위기 코드 없음).
 * @property {string} eventNews  이 분기 시작일에 띄울 속보 헤드라인(빈 문자열 = 없음)
 * @property {string} hintText   이 분기 시작일에 줄 코칭 문구(빈 문자열 = 없음)
 */

/**
 * @typedef {Object} SimulationDayData
 * @property {number} day      1..252
 * @property {number} quarter  1..4
 * @property {string} dateStr  모의 날짜 "YYYY-MM-DD"
 * @property {number} close    그 날 종가(원, 정수)
 * @property {number} [open]   현재 엔진은 종가만 산출한다 — OHLC/거래량은 후속.
 * @property {number} [high]
 * @property {number} [low]
 * @property {number} [volume]
 * @property {string} [event]  그 날 발화한 분기 이벤트 헤드라인
 */
