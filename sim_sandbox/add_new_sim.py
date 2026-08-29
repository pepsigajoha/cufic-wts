import streamlit as st
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from matplotlib import rc

# 한글 폰트 설정
try:
    rc('font', family='Malgun Gothic')
    plt.rcParams['axes.unicode_minus'] = False
except:
    pass

# ==========================================
# 1. 퀀트 수학 엔진 (3가지 결함 보정 버전)
# ==========================================
class MarketSimOriginal:
    def __init__(self, start_prices, beta_fx, beta_oil, max_steps=7560, seed=88):
        self.max_steps = max_steps
        self.current_step = 0
        self.n_companies = len(start_prices)
        
        self.history_prices = [np.array(start_prices, dtype=float)]
        
        self.history_unemp = [3.0] 
        self.history_gdp = [3.0]   
        self.history_int = [2.0]   
        self.history_inf = [2.0]   
        self.history_sent = [50.0] 
        self.history_fx = [1300.0]
        self.history_oil = [75.0]
        
        corr_matrix = np.full((self.n_companies, self.n_companies), 0.4)
        np.fill_diagonal(corr_matrix, 1.0)
        self.L = np.linalg.cholesky(corr_matrix)
        
        self.rng = np.random.default_rng(seed) 
        self.comp_multipliers = self.rng.uniform(0.5, 1.5, self.n_companies) 
        
        self.beta_fx = np.array(beta_fx)
        self.beta_oil = np.array(beta_oil)
        
        self.prev_ret = np.zeros(self.n_companies)
        self.current_var = None

    def next_step(self, 
                  unemp, gdp, int_r, inf, sent, fx, oil,
                  base_mu=0.05, tick_size=50,
                  w_s_unemp=-0.2, w_g_unemp=-0.3, 
                  w_s_gdp=0.5, w_g_gdp=0.5, 
                  w_s_int=-0.4, w_g_int=-0.4, 
                  w_s_inf=-0.3, w_g_inf=-0.3, 
                  w_s_sent=0.2, w_g_sent=0.2,
                  w_s_fx=0.3, w_g_fx=0.2, 
                  w_s_oil=-0.3, w_g_oil=-0.2,
                  omega=0.00001, alpha_garch=0.10, beta_garch=0.85,
                  thresh_unemp=5.0, thresh_inf=8.0,
                  lambda_jump=2.0, mu_jump=-0.05, sigma_jump=0.10):
        
        if self.current_step >= self.max_steps: 
            return False 
        
        if self.current_var is None:
            calc_beta = 0.99 - alpha_garch if alpha_garch + beta_garch >= 1.0 else beta_garch
            self.current_var = np.full(self.n_companies, omega / (1.0 - alpha_garch - calc_beta))
        
        base = {"unemp": 3.0, "gdp": 3.0, "int": 2.0, "inf": 2.0, "sent": 50.0, "fx": 1300.0, "oil": 75.0}
        
        # 1. Delta & Gravity 계산
        d_unemp = unemp - self.history_unemp[-1]; g_unemp = unemp - base["unemp"]
        d_gdp = gdp - self.history_gdp[-1];       g_gdp = gdp - base["gdp"]
        d_int = int_r - self.history_int[-1];     g_int = int_r - base["int"]
        d_inf = inf - self.history_inf[-1];       g_inf = inf - base["inf"]
        d_sent = (sent - self.history_sent[-1]) / 10.0; g_sent = (sent - base["sent"]) / 10.0
        d_fx = (fx - self.history_fx[-1]) / 100.0;      g_fx = (fx - base["fx"]) / 100.0
        d_oil = (oil - self.history_oil[-1]) / 10.0;    g_oil = (oil - base["oil"]) / 10.0
        
        # 2. 공통 거시 드리프트
        shock_effect = (w_s_unemp * d_unemp) + (w_s_gdp * d_gdp) + (w_s_int * d_int) + (w_s_inf * d_inf) + (w_s_sent * d_sent)
        gravity_effect = (w_g_unemp * g_unemp) + (w_g_gdp * g_gdp) + (w_g_int * g_int) + (w_g_inf * g_inf) + (w_g_sent * g_sent)
        common_drift = shock_effect + gravity_effect
        
        # 3. 섹터 고유 충격
        fx_effect = self.beta_fx * (w_s_fx * d_fx + w_g_fx * g_fx)
        oil_effect = self.beta_oil * (w_s_oil * d_oil + w_g_oil * g_oil)
        
        # [수정 1] comp_multipliers를 공통 항에만 적용 (섹터 베타 보존)
        dynamic_mu = (base_mu + common_drift) * self.comp_multipliers + fx_effect + oil_effect
        
        # 4. GARCH 변동성
        if alpha_garch + beta_garch >= 1.0: 
            beta_garch = 0.99 - alpha_garch
        self.current_var = omega + alpha_garch * (self.prev_ret**2) + beta_garch * self.current_var
        current_sigma = np.minimum(np.sqrt(self.current_var * 252), 2.0)
        
        if unemp > thresh_unemp or inf > thresh_inf:
            current_sigma = np.minimum(current_sigma * 2.0, 3.0)

        # 5. GBM 연속 적분
        jump_compensator = lambda_jump * (np.exp(mu_jump + 0.5 * sigma_jump**2) - 1.0)
        W = self.L.dot(self.rng.normal(0, 1, self.n_companies))
        drift = (dynamic_mu - 0.5 * current_sigma**2 - jump_compensator) * (1/252)
        shock = current_sigma * W * np.sqrt(1/252)
        
        # [수정 2] 원본 점프-확산 수식 복원
        num_jumps = self.rng.poisson(lambda_jump / 252, self.n_companies)
        jump_impact = self.rng.normal(mu_jump * num_jumps, sigma_jump * np.sqrt(num_jumps), self.n_companies)
        
        # 6. 최종 가격 계산
        raw_prices = self.history_prices[-1] * np.exp(drift + shock + jump_impact)
        new_prices = np.round(raw_prices / tick_size) * tick_size
        new_prices = np.maximum(new_prices, 1.0)
        
        self.prev_ret = np.clip(np.log(np.maximum(new_prices / self.history_prices[-1], 0.0001)), -0.5, 0.5)
        
        self.history_prices.append(new_prices)
        self.history_unemp.append(unemp); self.history_gdp.append(gdp)
        self.history_int.append(int_r); self.history_inf.append(inf); self.history_sent.append(sent)
        self.history_fx.append(fx); self.history_oil.append(oil)
        
        self.current_step += 1
        return True

# ==========================================
# 2. Streamlit UI 대시보드
# ==========================================
st.set_page_config(page_title="7대 거시지표 주가 발생기", layout="wide")
st.title("📈 7대 거시지표 하이브리드 주가 시뮬레이터")

stock_names = ["Tech (반도체/수출)", "Energy (정유/화학)", "Air (운송/수입)", "Auto (자동차)", "Retail (내수/유통)"]
init_prices = [10000, 10000, 10000, 10000, 10000]
beta_fx = [0.8, -0.1, -0.9, 0.7, -0.5]
beta_oil = [-0.2, 1.2, -1.1, -0.4, -0.3]

with st.sidebar:
    st.header("⚙️ 1. 경제 상황 조종")
    int_input = st.slider("🏦 기준금리 (%)", 0.0, 10.0, 2.0, 0.25)
    inf_input = st.slider("🛒 CPI 물가상승률 (%)", -2.0, 20.0, 2.0, 0.5)
    unemp_input = st.slider("🧑‍🔧 실업률 (%)", 1.0, 15.0, 3.0, 0.1)
    gdp_input = st.slider("🏭 GDP 성장률 (%)", -5.0, 15.0, 3.0, 0.5)
    fx_input = st.slider("💵 원/달러 환율 (원)", 1000.0, 1800.0, 1300.0, 10.0)
    oil_input = st.slider("🛢️ 국제유가 ($)", 20.0, 160.0, 75.0, 1.0)
    sent_input = st.slider("🛍️ 소비심리 (CSI)", 0.0, 100.0, 50.0, 1.0)
    
    st.divider()

    st.header("🛠️ 2. 하이브리드 파라미터")
    with st.expander("뉴스 충격(Shock) & 구조적 압박(Gravity)"):
        w_s_int = st.slider("금리 충격(Delta)", -5.0, 5.0, -0.4, 0.1)
        w_g_int = st.slider("금리 중력(Absolute)", -5.0, 5.0, -0.4, 0.1)
        w_s_inf = st.slider("물가 충격(Delta)", -5.0, 5.0, -0.3, 0.1)
        w_g_inf = st.slider("물가 중력(Absolute)", -5.0, 5.0, -0.3, 0.1)
        w_s_unemp = st.slider("실업률 충격(Delta)", -5.0, 5.0, -0.2, 0.1)
        w_g_unemp = st.slider("실업률 중력(Absolute)", -5.0, 5.0, -0.3, 0.1)
        w_s_gdp = st.slider("GDP 충격(Delta)", -5.0, 5.0, 0.5, 0.1)
        w_g_gdp = st.slider("GDP 중력(Absolute)", -5.0, 5.0, 0.5, 0.1)
        w_s_fx = st.slider("환율 충격(Delta)", -5.0, 5.0, 0.3, 0.1)
        w_g_fx = st.slider("환율 중력(Absolute)", -5.0, 5.0, 0.2, 0.1)
        w_s_oil = st.slider("유가 충격(Delta)", -5.0, 5.0, -0.3, 0.1)
        w_g_oil = st.slider("유가 중력(Absolute)", -5.0, 5.0, -0.2, 0.1)
        w_s_sent = st.slider("소비심리 충격(Delta)", -5.0, 5.0, 0.2, 0.1)
        w_g_sent = st.slider("소비심리 중력(Absolute)", -5.0, 5.0, 0.2, 0.1)
        
    st.divider()

    st.header("🦢 3. 블랙스완 (꼬리 위험) 파라미터")
    with st.expander("Merton Jump-Diffusion 설정"):
        st.caption("주가가 연속성을 잃고 갑작스럽게 갭(Gap) 하락/상승하는 돌발 이벤트를 제어합니다.")
        lambda_jump = st.slider("연간 돌발 이벤트 빈도 (λ)", 0.0, 20.0, 2.0, 1.0)
        mu_jump = st.slider("점프 방향성 편향 (μ_J)", -0.3, 0.3, -0.05, 0.01)
        sigma_jump = st.slider("점프 충격 크기 (σ_J)", 0.0, 0.5, 0.10, 0.01)

if "sim" not in st.session_state:
    st.session_state.sim = MarketSimOriginal(init_prices, beta_fx, beta_oil, max_steps=7560)

sim = st.session_state.sim

col1, col2, col3 = st.columns(3)
def trigger_steps(steps):
    for _ in range(steps):
        sim.next_step(
            unemp_input, gdp_input, int_input, inf_input, sent_input, fx_input, oil_input,
            0.05, 50,
            w_s_unemp, w_g_unemp, w_s_gdp, w_g_gdp, w_s_int, w_g_int, w_s_inf, w_g_inf, w_s_sent, w_g_sent,
            w_s_fx, w_g_fx, w_s_oil, w_g_oil,
            0.00001, 0.10, 0.85, 5.0, 8.0, lambda_jump, mu_jump, sigma_jump
        )

with col1:
    if st.button("▶ 다음 1일"):
        trigger_steps(1)
with col2:
    if st.button("⏩ 다음 1개월 (21일)"):
        trigger_steps(21)
with col3:
    if st.button("🚀 다음 1년 (252일)"):
        trigger_steps(252)
        
if st.button("🔄 리셋", use_container_width=True):
    st.session_state.sim = MarketSimOriginal(init_prices, beta_fx, beta_oil, max_steps=7560)
    st.rerun()

st.subheader(f"🗓️ 현재 진행 상황: {sim.current_step} / {sim.max_steps} 일 ({(sim.current_step/252):.1f}년)")

fig, (ax1, ax2, ax3, ax4) = plt.subplots(4, 1, figsize=(14, 12), gridspec_kw={'height_ratios': [3, 1.5, 1.5, 1]}, sharex=True)

# 1. 주가 차트
prices_array = np.array(sim.history_prices)
for i, name in enumerate(stock_names):
    ax1.plot(prices_array[:, i], label=name, lw=2, alpha=0.9)
ax1.set_title("섹터별 주가 궤적 (5개 대표 종목)", fontsize=12, fontweight='bold')
ax1.set_ylabel("Price (KRW)")
ax1.legend(loc='upper left')
ax1.grid(True, alpha=0.3)
ax1.set_xlim(0, max(252, sim.current_step + 10))

# 2. 거시경제 지표
ax2.plot(sim.history_int, color='blue', label='금리 (%)', lw=1.5)
ax2.plot(sim.history_inf, color='orange', label='CPI (%)', lw=1.5)
ax2.plot(sim.history_unemp, color='red', label='실업률 (%)', linestyle='--', lw=1.5)
ax2.plot(sim.history_gdp, color='green', label='GDP 성장률 (%)', lw=1.5)
ax2.set_title("거시경제 지표 (%)", fontsize=10)
ax2.set_ylabel("Percentage (%)")
ax2.grid(True, alpha=0.3)
ax2.legend(loc="upper left", fontsize=9, ncol=4)

# 3. 환율 / 유가
ax3.plot(sim.history_fx, color='purple', label='환율 (원/달러)', lw=2)
ax3.set_ylabel("환율 (원)", color='purple')
ax3.tick_params(axis='y', labelcolor='purple')
ax3_twin = ax3.twinx()
ax3_twin.plot(sim.history_oil, color='saddlebrown', label='국제유가 ($)', lw=2, linestyle='-.')
ax3_twin.set_ylabel("국제유가 ($)", color='saddlebrown')
ax3_twin.tick_params(axis='y', labelcolor='saddlebrown')
ax3.set_title("환율 및 국제유가", fontsize=10)
ax3.grid(True, alpha=0.3)
lines_1, labels_1 = ax3.get_legend_handles_labels()
lines_2, labels_2 = ax3_twin.get_legend_handles_labels()
ax3.legend(lines_1 + lines_2, labels_1 + labels_2, loc='upper left', fontsize=9, ncol=2)

# 4. 소비심리
ax4.plot(sim.history_sent, color='teal', lw=1.5)
ax4.fill_between(range(len(sim.history_sent)), sim.history_sent, 50, alpha=0.2, color='teal')
ax4.axhline(50.0, color='black', linestyle='--', alpha=0.5)
ax4.set_title("소비심리지수 (CSI)", fontsize=10)
ax4.set_ylabel("Index")
ax4.set_xlabel("Trading Days (1년 = 252일)")
ax4.set_ylim(0, 100)
ax4.grid(True, alpha=0.3)

plt.tight_layout()
st.pyplot(fig)
plt.close(fig)

with st.expander("📊 상세 데이터 로그 (CSV 다운로드)"):
    log_data = {
        "Day": range(sim.current_step + 1),
        "금리(%)": sim.history_int,
        "CPI(%)": sim.history_inf,
        "실업률(%)": sim.history_unemp,
        "GDP(%)": sim.history_gdp,
        "환율(원)": sim.history_fx,
        "유가($)": sim.history_oil,
        "CSI": sim.history_sent
    }
    for j, name in enumerate(stock_names):
        log_data[name] = prices_array[:, j]
    
    df_log = pd.DataFrame(log_data)
    format_dict = {name: "{:,.0f}" for name in stock_names}
    format_dict.update({"금리(%)": "{:.2f}", "CPI(%)": "{:.2f}", "실업률(%)": "{:.1f}", "GDP(%)": "{:.1f}", "환율(원)": "{:.1f}", "유가($)": "{:.1f}", "CSI": "{:.1f}"})
        
    st.dataframe(df_log.style.format(format_dict), use_container_width=True)
    
    csv = df_log.to_csv(index=False).encode('utf-8')
    st.download_button("📥 현재까지의 시뮬레이션 데이터 CSV 다운로드", data=csv, file_name='macro_7_simulation.csv', mime='text/csv')