import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // 0.0.0.0 바인딩 — 로컬 네트워크·터널에서 접근 가능하게
    // localhost.run/loca.lt 같은 임시 터널 도메인은 Vite의 host 검사에 막힌다
    // ("Blocked request. This host is not allowed"). 개발용 서버라 전부 허용해도 안전하다.
    allowedHosts: true,
  },
  test: {
    // 순수 계산 테스트는 node로 충분하지만, 컴포넌트 테스트(QtyStepper)가 DOM을 쓴다
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.js'],
    include: ['src/**/*.test.{js,jsx}'],
  },
})
