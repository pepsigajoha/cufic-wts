import numpy as np

class StepByStepMarketSim:
    def __init__(self, start_price=10000, max_steps=252, n_companies=10):
        self.max_steps = max_steps
        self.current_step = 0
        self.n_companies = n_companies
        
        self.history_prices = [np.full(n_companies, start_price, dtype=float)]
        self.history_unemp = [3.0] 
        self.history_gdp = [3.0]   
        self.history_int = [2.0]   
        self.history_inf = [2.0]   
        self.history_sent = [50.0] 
        
        corr_matrix = np.full((n_companies, n_companies), 0.4)
        np.fill_diagonal(corr_matrix, 1.0)
        self.L = np.linalg.cholesky(corr_matrix)
        
        self.rng = np.random.default_rng(88) 
        self.comp_multipliers = self.rng.uniform(0.5, 1.5, n_companies) 
        
        self.prev_ret = np.zeros(n_companies)
        self.current_var = None # GARCH 변동성 초기화 지연 (next_step에서 동적 처리)

    def next_step(self, 
                  unemp, gdp, int_r, inf, sent,
                  base_mu, tick_size,
                  w_s_unemp, w_g_unemp, w_s_gdp, w_g_gdp, w_s_int, w_g_int, w_s_inf, w_g_inf, w_s_sent, w_g_sent,
                  omega, alpha_garch, beta_garch,
                  thresh_unemp, thresh_inf,
                  lambda_jump, mu_jump, sigma_jump): # 점프-확산
        
        if self.current_step >= self.max_steps: return False 
        
        # GARCH 초기화 (첫 스텝에서 입력된 파라미터 기반으로 장기 평균 분산 할당)
        if self.current_var is None:
            calc_beta = 0.99 - alpha_garch if alpha_garch + beta_garch >= 1.0 else beta_garch
            self.current_var = np.full(self.n_companies, omega / (1.0 - alpha_garch - calc_beta))
        
        # 기준에 소비심리 추가
        base = {"unemp": 3.0, "gdp": 3.0, "int": 2.0, "inf": 2.0, "sent": 50.0}
        
        # (1) Delta(변화량) 계산
        d_unemp = unemp - self.history_unemp[-1] 
        d_gdp = gdp - self.history_gdp[-1]
        d_int = int_r - self.history_int[-1]
        d_inf = inf - self.history_inf[-1]
        d_sent = (sent - self.history_sent[-1]) / 10.0
        
        # (2) (Gravity) 구조적 압박 계산 (현재치 - 기준치)
        g_unemp = unemp - base["unemp"]
        g_gdp = gdp - base["gdp"]
        g_int = int_r - base["int"]
        g_inf = inf - base["inf"]
        g_sent = (sent - base["sent"]) / 10.0 # 소비심리 중력
        
        # (3) 하이브리드 드리프트 합산
        shock_effect = (w_s_unemp * d_unemp) + (w_s_gdp * d_gdp) + (w_s_int * d_int) + (w_s_inf * d_inf) + (w_s_sent * d_sent)
        gravity_effect = (w_g_unemp * g_unemp) + (w_g_gdp * g_gdp) + (w_g_int * g_int) + (w_g_inf * g_inf) + (w_g_sent * g_sent)
        
        dynamic_mu = (base_mu + shock_effect + gravity_effect) * self.comp_multipliers
        
        # (4) GARCH 변동성 계산
        if alpha_garch + beta_garch >= 1.0: beta_garch = 0.99 - alpha_garch
        self.current_var = omega + alpha_garch * (self.prev_ret**2) + beta_garch * self.current_var
        current_sigma = np.minimum(np.sqrt(self.current_var * 252), 2.0)
        
        if unemp > thresh_unemp or inf > thresh_inf:
            current_sigma = np.minimum(current_sigma * 2.0, 3.0)

        # 머튼 모델 점프 보상항(Jump Compensator) 계산 - 동적 기댓값 보존 목적
        jump_compensator = lambda_jump * (np.exp(mu_jump + 0.5 * sigma_jump**2) - 1.0)

        # (5) 기하학적 브라운 운동(GBM) 연속 항 (보상항 차감)
        W = self.L.dot(self.rng.normal(0, 1, self.n_companies))
        drift = (dynamic_mu - 0.5 * current_sigma**2 - jump_compensator) * (1/252)
        shock = current_sigma * W * np.sqrt(1/252)
        
        # (6) 머튼의 점프-확산(Jump-Diffusion)
        num_jumps = self.rng.poisson(lambda_jump / 252, self.n_companies)
        # 복수 점프 발생 시 수학적 분산 왜곡 방지 (k번 점프 -> mu*k, sigma*sqrt(k))
        jump_impact = self.rng.normal(mu_jump * num_jumps, sigma_jump * np.sqrt(num_jumps), self.n_companies)
        
        # (7) 최종 주가 : 드리프트 + 연속충격(GBM) + 단절충격(Jump)
        raw_prices = self.history_prices[-1] * np.exp(drift + shock + jump_impact)
        
        new_prices = np.round(raw_prices / tick_size) * tick_size
        new_prices = np.maximum(new_prices, 1.0)
        
        self.prev_ret = np.clip(np.log(np.maximum(new_prices / self.history_prices[-1], 0.0001)), -0.5, 0.5)
        
        self.history_prices.append(new_prices)
        self.history_unemp.append(unemp); self.history_gdp.append(gdp)
        self.history_int.append(int_r); self.history_inf.append(inf); self.history_sent.append(sent)
        self.current_step += 1
        return True