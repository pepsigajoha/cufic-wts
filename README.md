# CUFIC-WTS (Web Trading System)

실시간 금융 데이터 파이프라인 구축 및 차트 패턴/파생상품 분석을 지원하는 웹 트레이딩 시스템(WTS) 프로젝트입니다.

---

## 📌 주요 기능 (Key Features)

- **실시간 주가 파이프라인 (Real-time Price Stream)**: 주식 및 파생상품의 실시간 시세 데이터 수집 및 처리
- **파생상품 분석 (Derivatives Support)**: 파생상품 데이터 연동 및 지표 산출
- **기술적 지표 및 차트 파이프라인**: 이동평균선(MA) 등 기술적 지표 생성 및 시각화 데이터 전처리
- **딥러닝/패턴 모델 연계 (ResNet Pipeline)**: 차트 이미지 및 시계열 데이터 기반의 분석/예측 파이프라인 구조화

---

## 🛠 기술 스택 (Tech Stack)

- **Language**: Python 3.10+
- **Deep Learning / Analysis**: PyTorch / ResNet, Pandas, NumPy
- **Data & API**: WebSocket / REST API, Finance Data Collector
- **Version Control**: Git / GitHub

---

## 📂 프로젝트 구조 (Project Structure)

```text
cufic-wts/
├── cufic/                     # 메인 애플리케이션 및 모듈 패키지
│   ├── live_price/           # 실시간 시세 및 파생상품 데이터 처리
│   ├── indicators/           # 기술적 지표 (이동평균선 등)
│   └── models/               # ResNet 등 차트 분석/예측 모델
├── config/                   # API 키 및 환경 설정
├── tests/                    # 단위 및 통합 테스트
├── requirements.txt          # 의존성 패키지 목록
└── README.md
```

---

## 🚀 시작 가이드 (Getting Started)

### 1. 레포지토리 클론
```bash
git clone [https://github.com/pepsigajoha/cufic-wts.git](https://github.com/pepsigajoha/cufic-wts.git)
cd cufic-wts
```

### 2. 가상환경 구성 및 패키지 설치
```bash
python -m venv venv
# Windows (Git Bash)
source venv/Scripts/activate
# Windows (CMD)
venv\Scripts\activate.bat

pip install -r requirements.txt
```

### 3. 환경 변수 설정
프로젝트 루트에 `.env` 파일을 생성하고 필요한 설정을 입력합니다:
```env
# API Key 및 접속 설정 예시
BROKER_API_KEY=your_api_key_here
BROKER_SECRET_KEY=your_secret_key_here
```

### 4. 실행
```bash
python -m cufic.main
```

---

## 🌿 브랜치 전략 (Branch Strategy)

- `main`: 상용/배포 가능한 안정화 브랜치
- `feature/*` / `live_price_*`: 신규 기능 개발 및 데이터 파이프라인 구현
- `refactor-*`: 코드 리팩토링 및 구조 개선
