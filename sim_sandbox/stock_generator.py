import streamlit as st
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from market_sim import StepByStepMarketSim

# 페이지 설정
st.set_page_config(page_title="주가 발생기 (하이브리드 다요인 주가 시뮬레이터)", layout="wide")
st.title("📈  주가 발생기")

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

    # 점프-확산 블랙스완 파라미터 UI
    st.header("🦢 3. 블랙스완 (꼬리 위험) 파라미터")
    with st.expander("Merton Jump-Diffusion 설정"):
        st.caption("주가가 연속성을 잃고 갑작스럽게 갭(Gap) 하락/상승하는 돌발 이벤트를 제어합니다.")
        # 연간 평균 점프 발생 횟수 (푸아송 분포의 람다)
        lambda_jump = st.slider("연간 돌발 이벤트 빈도 (λ)", 0.0, 20.0, 2.0, 1.0)
        # 점프가 발생했을 때 가격 변동의 방향성 편향 (음수면 폭락 편향)
        mu_jump = st.slider("점프 방향성 편향 (μ_J)", -0.3, 0.3, -0.05, 0.01)
        # 점프가 발생했을 때 가격 변동의 크기(변동성)
        sigma_jump = st.slider("점프 충격 크기 (σ_J)", 0.0, 0.5, 0.10, 0.01)

    st.divider()
    
    # 세션 관리 및 시뮬레이션 초기화
    if "sim" not in st.session_state:
        st.session_state.sim = StepByStepMarketSim(start_price=10000, max_steps=252, n_companies=10)
    
    sim = st.session_state.sim
    
    # 버튼 로직: 다음 스텝 진행 (점프 파라미터 전달 추가)
    col1, col2 = st.columns(2)
    with col1:
        if st.button("▶ 다음 1일"):
            sim.next_step(unemp_input, gdp_input, int_input, inf_input, sent_input, 
                          0.05, 50, 
                          w_s_unemp, w_g_unemp, w_s_gdp, w_g_gdp, w_s_int, w_g_int, w_s_inf, w_g_inf, w_s_sent, w_g_sent,
                          0.00001, 0.10, 0.85, 5.0, 8.0,
                          lambda_jump, mu_jump, sigma_jump) # 점프 인자 전달
    with col2:
        if st.button("⏩ 다음 10일"):
            for _ in range(10):
                if not sim.next_step(unemp_input, gdp_input, int_input, inf_input, sent_input, 
                                     0.05, 50, 
                                     w_s_unemp, w_g_unemp, w_s_gdp, w_g_gdp, w_s_int, w_g_int, w_s_inf, w_g_inf, w_s_sent, w_g_sent,
                                     0.00001, 0.10, 0.85, 5.0, 8.0,
                                     lambda_jump, mu_jump, sigma_jump): break # 점프 인자 전달
    
    if st.button("🔄 리셋", use_container_width=True):
        st.session_state.sim = StepByStepMarketSim(10000, 252, 10)
        st.rerun()

# 메인 화면 시각화
st.subheader(f"🗓️ 현재 진행 상황: {sim.current_step} / {sim.max_steps} 일")

fig, (ax1, ax2, ax3) = plt.subplots(3, 1, figsize=(12, 9), gridspec_kw={'height_ratios': [3, 1.5, 1]}, sharex=True)

# 1. 주가 차트
prices_array = np.array(sim.history_prices)
ax1.plot(prices_array, alpha=0.8)
ax1.set_title("Simulated Stock Prices (10 Correlated Companies)", fontsize=12, fontweight='bold')
ax1.set_ylabel("Price (KRW)")
ax1.grid(True, alpha=0.3)
ax1.set_xlim(0, sim.max_steps)

# 위기 국면 배경 처리
for i in range(len(sim.history_unemp)):
    if sim.history_unemp[i] > 5.0 or sim.history_inf[i] > 8.0:
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
ax2.legend(loc="upper left", fontsize=8, ncol=3)

# 3. 소비심리 차트
ax3.plot(sim.history_sent, color='purple', lw=1.5)
ax3.fill_between(range(len(sim.history_sent)), sim.history_sent, 50, alpha=0.2, color='purple')
ax3.axhline(50.0, color='black', linestyle='--', alpha=0.5)
ax3.set_title("Consumer Sentiment Index (0 - 100)", fontsize=10)
ax3.set_ylabel("Index")
ax3.set_xlabel("Trading Days")
ax3.set_ylim(0, 100)
ax3.grid(True, alpha=0.3)

plt.tight_layout()
st.pyplot(fig)
plt.close(fig) # Streamlit 서버 메모리 폭주 방지

# 하단 데이터 로그 및 CSV 다운로드
with st.expander("📊 10개 회사 상세 데이터 로그 확인"):
    log_data = {
        "Day": range(sim.current_step + 1),
        "Interest(%)": sim.history_int,
        "Unemp(%)": sim.history_unemp,
        "Inflation(%)": sim.history_inf,
        "GDP(%)": sim.history_gdp,
        "Sentiment": sim.history_sent
    }
    for j in range(10):
        log_data[f"Comp_{j+1}"] = prices_array[:, j]
    
    df_log = pd.DataFrame(log_data)
    
    format_dict = {f"Comp_{j+1}": "{:,.0f}" for j in range(10)}
    format_dict.update({"Interest(%)": "{:.2f}", "Unemp(%)": "{:.1f}", "Inflation(%)": "{:.1f}", "GDP(%)": "{:.1f}", "Sentiment": "{:.1f}"})
        
    st.dataframe(df_log.style.format(format_dict), use_container_width=True)
    
    csv = df_log.to_csv(index=False).encode('utf-8')
    st.download_button("📥 현재까지의 시뮬레이션 데이터 CSV 다운로드", data=csv, file_name='10_companies_simulation_data.csv', mime='text/csv')
