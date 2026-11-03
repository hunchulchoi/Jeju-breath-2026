/** 냄새 물결 + 지도 격자 심볼 */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="8" fill="#1f6f68" />
      <path d="M11 4v24M21 4v24M4 11h24M4 21h24" stroke="#ffffff" strokeOpacity="0.25" strokeWidth="1.2" />
      <path
        d="M7 13c2.2-2.4 4.4-2.4 6.6 0s4.4 2.4 6.6 0 3.6-2 4.8-1"
        fill="none"
        stroke="#fde68a"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M7 19.5c2.2-2.4 4.4-2.4 6.6 0s4.4 2.4 6.6 0 3.6-2 4.8-1"
        fill="none"
        stroke="#fb923c"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
