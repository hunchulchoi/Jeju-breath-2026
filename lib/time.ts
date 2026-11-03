// 모든 시각은 Asia/Seoul(UTC+9, 서머타임 없음) 기준 ISO 문자열로 저장한다.
const OFFSET_MS = 9 * 60 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, "0");

/** 2026-11-03T18:20:05+09:00 형식 */
export function toSeoulISO(date: Date): string {
  const d = new Date(date.getTime() + OFFSET_MS);
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+09:00`
  );
}

/** YYYY-MM-DD (서울 날짜) */
export function seoulDay(date: Date): string {
  return toSeoulISO(date).slice(0, 10);
}

export function isValidDay(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** 오늘 포함 최근 n일 (최신순) */
export function recentDays(now: Date, n: number): string[] {
  const days: string[] = [];
  let day = seoulDay(now);
  for (let i = 0; i < n; i++) {
    days.push(day);
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    day = d.toISOString().slice(0, 10);
  }
  return days;
}

/** "18:20" */
export function formatTime(iso: string): string {
  return iso.slice(11, 16);
}
