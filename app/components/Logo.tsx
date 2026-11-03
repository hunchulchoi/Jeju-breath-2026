/** 제주 오름 위로 흐르는 바람과 햇살 심볼 */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="17" fill="#1f6f68" />
      <circle cx="45" cy="18" r="4" fill="#f4b183" />
      <path
        d="M13 35c8 0 10-14 17-14s11 14 21 14"
        fill="none"
        stroke="#f6f4ef"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      <path
        d="M13 46h23c7 0 12-2 15-6"
        fill="none"
        stroke="#f6f4ef"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
