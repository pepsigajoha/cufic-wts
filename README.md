# 📈 하이브리드 다요인 주가 시뮬레이터 (Hybrid Multi-Factor Market Simulator)

![Python](https://img.shields.io/badge/Python-3.8+-blue.svg)
![Streamlit](https://img.shields.io/badge/Streamlit-1.20+-red.svg)
![NumPy](https://img.shields.io/badge/NumPy-Data_Science-yellow.svg)
![Finance](https://img.shields.io/badge/Domain-Quant_Finance-green.svg)

---

<img width="1460" height="1092" alt="3d6956212d1b3b323408ec6256ea344d" src="https://github.com/user-attachments/assets/d9f7a952-4144-4031-9462-c62d8d3e253b" />

거시경제 변수(금리·물가·실업률·GDP·소비심리 등)로 움직이는 주가를 확률과정으로 모사하는 엔진.
Streamlit 프로토타입에서 시작해, 엔진의 순수 JS 이식과 실전 교육용 웹앱(cufic)까지 이어지고 있다.

## 🆕 업데이트 (최신순)

- **리팩토링** — cufic을 서브모듈 gitlink가 아닌 실제 추적 파일로 편입, 엔진을 JS로 이식한
  `sim_sandbox/` 추가, 환율·유가를 더한 7대 거시요인 확장판 `add_new_sim.py` 추가
- **수식수정** — GARCH 장기분산 초기화를 파라미터 기반 동적 계산으로 변경, 점프-확산에
  보상항(jump compensator)을 추가해 기댓값 왜곡 제거, 복수 점프 발생 시 분산 보정
  (`mu_jump*k`, `sigma_jump*sqrt(k)`)
- **이동평균 추가** — `mean.py`: 60일 이동평균 뷰 토글과 5년(1260일) 라운드제 UI로 개편

## 📂 프로젝트 구성

| 경로 | 설명 |
|---|---|
| `market_sim.py` | 핵심 엔진(`StepByStepMarketSim`). 10종목, 5대 거시요인(금리·실업률·물가·GDP·소비심리) |
| `stock_generator.py` | 최초 버전 Streamlit 앱 (1일 / 10일 스텝 진행) |
| `mean.py` | 60일 이동평균 뷰 + 5년(1260일) 라운드제로 개편한 Streamlit 앱 |
| `add_new_sim.py` | 환율·유가·섹터 베타를 더한 7대 거시요인 확장판 (5개 섹터 종목) |
| `sim_sandbox/` | `add_new_sim.py` 엔진의 순수 JS 포팅 (npm 의존성 0) + 브라우저 데모 + 검증/스트레스 테스트 |
| `cufic/` | 위 엔진을 실전 적용한 청소년 교육용 라운드제 모의투자 웹앱 (React + Supabase). 별도 [README](cufic/README.md) 참고 |

## 주요 공식

최종 주가는 세 가지 핵심 공식으로 발생

### 1. 거시경제 동적 드리프트 (Dynamic Macro Drift)
전통적 모델의 고정된 연평균 기대 수익률($\mu$)을 동적인 거시경제 함수로 대체

$$ \mu_t = \mu_{base} + \sum (w_{s, i} \cdot \Delta x_i) + \sum (w_{g, i} \cdot (x_i - base_i)) $$

*   **뉴스 충격(Shock, $\Delta x_i$):** 전일 대비 경제 지표의 단기적 변화량 (예: 금리 깜짝 인상 시 즉각적인 시장 발작 모사)
*   **구조적 중력(Gravity, $x_i - base_i$):** 현재 경제 지표가 정상 궤도(Base)에서 벗어나 있는 절대적 격차 (예: 고금리가 장기화될 때 매일 주가 상승을 억누르는 만성적 압박 모사)

### 2. GARCH(1,1) 기반 레짐 스위칭 변동성
위기 국면에서의 변동성 군집 현상을 계산

$$ \sigma_t^2 = \omega + \alpha \cdot r_{t-1}^2 + \beta \cdot \sigma_{t-1}^2 $$

*   $\alpha \cdot r_{t-1}^2$ (ARCH 항): 전날 발생한 큰 주가 충격이 오늘의 리스크를 증가
*   $\beta \cdot \sigma_{t-1}^2$ (GARCH 항): 한 번 불안해진 시장은 지속적으로 불안한 상태를 유지하려는 관성을 가짐
*   **레짐 스위칭(Regime Switching):** 실업률 5% 또는 물가 8% 초과 시 $\sigma_t$를 강제로 2배 폭증시켜 금융 위기 국면으로 전환

### 3. 머튼 점프-확산 모형 (Merton Jump-Diffusion SDE)
이토의 보조정리(Ito's Lemma)를 적용한 일간 주가 최종 이산화 공식

$$ S_{t+\Delta t} = S_t \exp\left( \left(\mu_t - \frac{\sigma_t^2}{2} - \lambda(e^{\mu_J + \frac{1}{2}\sigma_J^2}-1)\right)\Delta t + \sigma_t \sqrt{\Delta t} Z_1 + Z_2 N_t \right) $$

*   **볼래틸리티 드래그 ($-\frac{\sigma_t^2}{2}$):** 기하학적 복리 수익률 특성상 변동성이 커질수록 계좌가 녹아내리는 현상을 수학적으로 구현
*   **점프 보상항 (Jump Compensator, $-\lambda(e^{\mu_J + \frac{1}{2}\sigma_J^2}-1)$):** 점프가 드리프트의 기댓값을 왜곡하지 않도록 상쇄
*   **확산 항 ($\sigma_t \sqrt{\Delta t} Z_1$):** 숄레스키 분해를 통해 상관관계가 얽힌 종목들의 연속적인 무작위 움직임
*   **점프 항 ($Z_2 N_t$):** 포아송 분포($N_t \sim Poisson(\lambda)$)를 따르는 희소한 '블랙스완' 이벤트 발생 / 시장에서 갭 하락·상승(단절)을 발생. 한 스텝에 점프가 k번 겹치면 $\mu_J \cdot k$, $\sigma_J \sqrt{k}$로 보정해 분산 왜곡을 방지

---

## 🚀 설치 및 실행 방법

```bash
# 1. 필요 라이브러리 설치
pip install streamlit numpy pandas matplotlib

# 2. 원하는 버전 실행 (stock_maker 디렉토리에서)
streamlit run stock_generator.py   # 기본: 5대 거시요인, 1일/10일 스텝
streamlit run mean.py              # 이동평균 뷰 + 5년 라운드제
streamlit run add_new_sim.py       # 7대 거시요인(환율·유가) 확장판
```

### sim_sandbox (엔진 JS 포팅)

```bash
cd sim_sandbox
node verify.js        # 수식 검증
node stress_test.js   # 5라운드 연속 시뮬레이션 캘리브레이션 점검
node server.js         # 브라우저 데모: http://localhost:8787
```

### cufic (실전 웹앱)

`cufic/` 는 별도 React + Supabase 프로젝트다. 실행 방법은 [cufic/README.md](cufic/README.md) 참고.
