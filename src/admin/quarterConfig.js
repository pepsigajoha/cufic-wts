// 분기 config(QuarterConfig)의 기본값·검증. 거시 7요인 기본값(defaultMacro)이 엔진에 있어서
// 이 헬퍼는 관리자 모듈에 둔다(학생 번들이 엔진을 끌어오지 않게). shape 정의는 src/quarters.js.

import { defaultMacro } from './priceSim'
import { MACRO_KEYS } from './macroFields'

/** 프리셋/직접입력 전 중립 세트 — 4분기 모두 기본 거시값. */
export function defaultQuarterConfigs() {
  return [1, 2, 3, 4].map((quarter) => ({
    quarter,
    macro: defaultMacro(),
    eventNews: '',
    hintText: '',
  }))
}

/** 엔진·서버에 넘기기 전 방어. 길이 4 + 각 분기에 유한한 거시 7요인. */
export function isValidQuarterConfigs(quarters) {
  return (
    Array.isArray(quarters) &&
    quarters.length === 4 &&
    quarters.every(
      (q) =>
        q &&
        q.macro &&
        typeof q.macro === 'object' &&
        MACRO_KEYS.every((k) => Number.isFinite(Number(q.macro[k]))),
    )
  )
}

/** 부분 macro를 기본값으로 채운 완전한 분기 세트로 정규화(프리셋이 일부 키만 지정해도 되게). */
export function normalizeQuarterConfigs(quarters) {
  return quarters.map((q, i) => ({
    quarter: q.quarter ?? i + 1,
    macro: { ...defaultMacro(), ...(q.macro ?? {}) },
    eventNews: q.eventNews ?? '',
    hintText: q.hintText ?? '',
  }))
}
