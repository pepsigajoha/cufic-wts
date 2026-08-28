/**
 * 세로 화면 안내. 표시 여부는 전적으로 CSS 미디어 쿼리가 정한다
 * (@media (orientation: portrait) and (max-width: 1023px))
 * — JS로 방향을 감지하지 않으므로 가로로 돌리면 즉시 자동 복귀한다.
 */
export default function RotateNotice() {
  return (
    <div className="rotate-notice">
      <div className="rn-card">
        <svg
          className="ico"
          width="72"
          height="72"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="7" y="2" width="10" height="20" rx="2" />
          <path d="M11 18h2" />
        </svg>
        <h2>태블릿을 가로로 돌려주세요</h2>
        <p>CUFIC WTS는 가로 화면에 맞춰져 있어요. 기기를 돌리면 바로 이어서 볼 수 있어요.</p>
      </div>
    </div>
  )
}
