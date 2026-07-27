import streamlit as st
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from market_sim import StepByStepMarketSim

# 페이지 설정
st.set_page_config(page_title="주가 발생기 (하이브리드 다요인 주가 시뮬레이터)", layout="wide")
st.title("📈 거시경제 주가 시뮬레이터 (5년 사이클)")

# 사이드바 설정
with st.sidebar:
    st.header("⚙️ 1. 경제 상황 조종")
    int_input = st.slider("🏦 기준금리 (%)", 0.0, 10.0, 2.0, 0.25)
    unemp_input = st.slider("🧑‍🔧 실업률 (%)", 1.0, 15.0, 3.0, 0.1)
    inf_input = st.slider("🛒 물가상승률 (%)", -2.0, 20.0, 2.0, 0.5)
    gdp_input = st.slider("🏭 GDP 성장률 (%)", -5.0, 15.0, 3.0, 0.5)
    sent_input = st.slider("🛍️ 소비심리", 0.0, 100.0, 50.0, 1.0)
    
    st.divider()

    st.header("🛠️ 2. 하이브리드 파라미터")
    with st.expander("뉴스 충격(Shock) & 구조적 압박(Gravity)"):
        w_s_int = st.slider("금리 충격(Delta)", -5.0, 5.0, -0.4, 0.1)
        w_g_int = st.slider("금리 중력(Absolute)", -5.0, 5.0, -0.4, 0.1)
        
        w_s_unemp = st.slider("실업률 충격(Delta)", -5.0, 5.0, -0.2, 0.1)
        w_g_unemp = st.slider("실업률 중력(Absolute)", -5.0, 5.0, -0.3, 0.1)
        
        w_s_gdp = st.slider("GDP 충격(Delta)", -5.0, 5.0, 0.5, 0.1)
        w_g_gdp = st.slider("GDP 중력(Absolute)", -5.0, 5.0, 0.5, 0.1)
        
        w_s_inf = st.slider("물가 충격(Delta)", -5.0, 5.0, -0.3, 0.1)
        w_g_inf = st.slider("물가 중력(Absolute)", -5.0, 5.0, -0.3, 0.1)
        
        w_s_sent = st.slider("소비심리 충격(Delta)", -5.0, 5.0, 0.2, 0.1)
        w_g_sent = st.slider("소비심리 중력(Absolute)", -5.0, 5.0, 0.2, 0.1)
        
    st.divider()

    st.header("🦢 3. 블랙스완 (꼬리 위험) 파라미터")
    with st.expander("Merton Jump-Diffusion 설정"):
        st.caption("주가가 연속성을 잃고 갑작스럽게 갭(Gap) 하락/상승하는 돌발 이벤트를 제어합니다.")
        lambda_jump = st.slider("연간 돌발 이벤트 빈도 (λ)", 0.0, 20.0, 2.0, 1.0)
        mu_jump = st.slider("점프 방향성 편향 (μ_J)", -0.3, 0.3, -0.05, 0.01)
        sigma_jump = st.slider("점프 충격 크기 (σ_J)", 0.0, 0.5, 0.10, 0.01)

    st.divider()
    
    # [수정] 5년(1260일) 사이클로 세션 초기화
    if "sim" not in st.session_state:
        st.session_state.sim = StepByStepMarketSim(start_price=10000, max_steps=1260, n_companies=10)
    
    sim = st.session_state.sim
    
    # next_step 파라미터 패킹 (코드 중복 제거)
    step_params = {
        "unemp": unemp_input, "gdp": gdp_input, "int_r": int_input, "inf": inf_input, "sent": sent_input,
        "base_mu": 0.05, "tick_size": 50,
        "w_s_unemp": w_s_unemp, "w_g_unemp": w_g_unemp, "w_s_gdp": w_s_gdp, "w_g_gdp": w_g_gdp,
        "w_s_int": w_s_int, "w_g_int": w_g_int, "w_s_inf": w_s_inf, "w_g_inf": w_g_inf,
        "w_s_sent": w_s_sent, "w_g_sent": w_g_sent,
        "omega": 0.00001, "alpha_garch": 0.10, "beta_garch": 0.85,
        "thresh_unemp": 5.0, "thresh_inf": 8.0,
        "lambda_jump": lambda_jump, "mu_jump": mu_jump, "sigma_jump": sigma_jump
    }

    # [수정] 1라운드(1년) 진행 버튼
    col1, col2 = st.columns(2)
    with col1:
        if st.button("▶ 다음 1라운드(1년)", use_container_width=True):
            for _ in range(252): # 1년치(252일) 한 번에 실행
                if not sim.next_step(**step_params): break
    with col2:
        if st.button("🔄 리셋", use_container_width=True):
            st.session_state.sim = StepByStepMarketSim(10000, 1260, 10)
            st.rerun()

# ==========================================
# 메인 화면 시각화 영역
# ==========================================
st.subheader(f"🗓️ 진행 상황: {sim.current_step} 일 / 총 1260 일 (5년)")

# [핵심] 차트 뷰 전환 토글 (라디오 버튼)
view_mode = st.radio(
    "📊 차트 표시 방식 선택:",
    ["📈 60일 이동평균선 적용 (거시적 추세 보기)", "📉 원본 주가 (일일 지그재그 변동성 보기)"],
    horizontal=True
)

fig, (ax1, ax2, ax3) = plt.subplots(3, 1, figsize=(12, 9), gridspec_kw={'height_ratios': [3, 1.5, 1]}, sharex=True)

prices_array = np.array(sim.history_prices)

# 1. 주가 차트 (뷰 모드에 따른 데이터 분기)
if "이동평균선" in view_mode:
    # 60일 이동평균선 적용
    df_prices = pd.DataFrame(prices_array)
    plot_data = df_prices.rolling(window=60, min_periods=1).mean().values
    ax1.plot(plot_data, alpha=0.8, linewidth=2.0)
    ax1.set_title("Simulated Stock Prices (60-Day Moving Average)", fontsize=12, fontweight='bold')
else:
    # 원본 데이터 적용
    plot_data = prices_array
    ax1.plot(plot_data, alpha=0.6, linewidth=1.0)
    ax1.set_title("Simulated Stock Prices (Raw Daily Data)", fontsize=12, fontweight='bold')

ax1.set_ylabel("Price (KRW)")
ax1.grid(True, alpha=0.3)

# [수정] X축을 1년 단위로 축소 및 라벨링
years_ticks = [0, 252, 504, 756, 1008, 1260]
years_labels = ['Start', 'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5']
ax1.set_xticks(years_ticks)
ax1.set_xticklabels(years_labels, fontsize=11, fontweight='bold')
ax1.set_xlim(0, 1260)

# 위기 국면 배경 처리 (실업률 5% 초과 구간)
history_unemp = np.array(sim.history_unemp)
crisis_indices = np.where(history_unemp > 5.0)[0]
for i in crisis_indices:
    ax1.axvspan(i - 0.5, i + 0.5, color='red', alpha=0.15, lw=0)

# 2. 경제 지표 차트
ax2.plot(sim.history_int, color='blue', label='Interest Rate (%)', lw=1.5)
ax2.plot(sim.history_inf, color='orange', label='Inflation (%)', lw=1.5)
ax2.plot(sim.history_unemp, color='red', label='Unemployment (%)', linestyle='--', lw=1.5)
ax2.plot(sim.history_gdp, color='green', label='GDP Growth (%)', lw=1.5)
ax2.axhline(5.0, color='red', linestyle=':', alpha=0.5, label='Crisis (Unemp > 5%)')
ax2.axhline(8.0, color='orange', linestyle=':', alpha=0.5, label='Crisis (Inf > 8%)')
ax2.set_title("Macroeconomic Rates (%)", fontsize=10)
ax2.set_ylabel("Percentage (%)")
ax2.grid(True, alpha=0.3)
ax2.legend(loc="upper left", fontsize=8, ncol=6)

# 3. 소비심리 차트
ax3.plot(sim.history_sent, color='purple', lw=1.5)
ax3.fill_between(range(len(sim.history_sent)), sim.history_sent, 50, alpha=0.2, color='purple')
ax3.axhline(50.0, color='black', linestyle='--', alpha=0.5)
ax3.set_title("Consumer Sentiment Index (0 - 100)", fontsize=10)
ax3.set_ylabel("Index")
ax3.set_xlabel("Simulation Rounds (1 Year = 252 Days)")
ax3.set_ylim(0, 100)
ax3.grid(True, alpha=0.3)

plt.tight_layout()
st.pyplot(fig)
plt.close(fig)

# 하단 데이터 로그 및 CSV 다운로드 (원본 데이터 유지)
with st.expander("📊 10개 회사 상세 데이터 로그 확인 (Raw Data)"):
    log_data = {
        "Day": range(sim.current_step + 1),
        "Interest(%)": sim.history_int,
        "Unemp(%)": sim.history_unemp,
        "Inflation(%)": sim.history_inf,
        "GDP(%)": sim.history_gdp,
        "Sentiment": sim.history_sent
    }
    # 화면 표시와 무관하게 로그는 항상 실제 원본 주가(prices_array)를 기록합니다.
    for j in range(10):
        log_data[f"Comp_{j+1}"] = prices_array[:, j]
    
    df_log = pd.DataFrame(log_data)
    
    format_dict = {f"Comp_{j+1}": "{:,.0f}" for j in range(10)}
    format_dict.update({"Interest(%)": "{:.2f}", "Unemp(%)": "{:.1f}", "Inflation(%)": "{:.1f}", "GDP(%)": "{:.1f}", "Sentiment": "{:.1f}"})
        
    st.dataframe(df_log.style.format(format_dict), use_container_width=True)
    
    csv = df_log.to_csv(index=False).encode('utf-8')
    st.download_button(
        "📥 현재까지의 시뮬레이션 데이터 CSV 다운로드", 
        data=csv, 
        file_name='10_companies_macro_simulation.csv', 
        mime='text/csv'
    )