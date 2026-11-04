import type { Queryable } from "./db";
import { dayRange } from "./time";
import { ODOR_DISPLAY, ODOR_TYPES, type OdorType } from "./types";

export const STATS_DAYS = [1, 7, 30] as const;
export type StatsDays = (typeof STATS_DAYS)[number];

export function parseStatsDays(v: string | null): StatsDays | null {
  if (v === null) return 7;
  return v === "1" ? 1 : v === "7" ? 7 : v === "30" ? 30 : null;
}

export interface Stats {
  range: { from: string; to: string; days: number };
  totals: {
    reports: number;
    high: number;
    merged_extra: number;
    review: number;
    location_failures: number;
    has_demo: boolean;
  };
  by_day: { date: string; counts: Record<number, number> }[];
  by_hour: { hour: number; count: number }[];
  by_intensity: { intensity: number; count: number }[];
  by_odor: { odor_type: string; label: string; count: number }[];
  funnel: {
    started: number;
    saved: number;
    map_viewed: number;
    completion_rate: number | null;
    gps_allow_rate: number | null;
    map_view_rate: number | null;
  };
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 기간 = today 포함 최근 days일(서울 날짜). needs_review 제보는 집계에서 빼고 개수만 따로 센다. */
export async function getStats(db: Queryable, opts: { days: number; today: string }): Promise<Stats> {
  const { days, today } = opts;
  const from = addDays(today, -(days - 1));
  const [start] = dayRange(from);
  const [, end] = dayRange(today);

  const { rows } = await db.query<{
    day: string;
    hour: number;
    intensity: number;
    odor_type: string;
    n: number;
    extra: number;
  }>(
    `SELECT to_char(reported_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS day,
            EXTRACT(HOUR FROM reported_at AT TIME ZONE 'Asia/Seoul')::int AS hour,
            intensity, odor_type,
            COUNT(*)::int AS n,
            COALESCE(SUM(merged_count - 1), 0)::int AS extra
     FROM reports
     WHERE reported_at >= $1 AND reported_at < $2 AND NOT needs_review
     GROUP BY 1, 2, 3, 4`,
    [start, end],
  );
  const { rows: meta } = await db.query<{ review: number; has_demo: boolean }>(
    `SELECT COUNT(*) FILTER (WHERE needs_review)::int AS review,
            COALESCE(BOOL_OR(is_demo), FALSE) AS has_demo
     FROM reports WHERE reported_at >= $1 AND reported_at < $2`,
    [start, end],
  );
  const { rows: fail } = await db.query<{ n: number }>(
    `SELECT COALESCE(SUM(count), 0)::int AS n FROM location_failures WHERE day >= $1 AND day <= $2`,
    [from, today],
  );
  const { rows: ev } = await db.query<{ name: string; n: number }>(
    `SELECT name, COALESCE(SUM(count), 0)::int AS n FROM event_counts
     WHERE day >= $1 AND day <= $2 GROUP BY name`,
    [from, today],
  );

  const byDay = new Map<string, Record<number, number>>();
  for (let i = 0; i < days; i++) byDay.set(addDays(from, i), { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  const byIntensity = [1, 2, 3, 4, 5].map((intensity) => ({ intensity, count: 0 }));
  const odor = new Map<string, number>();
  let reports = 0;
  let high = 0;
  let mergedExtra = 0;
  for (const r of rows) {
    const d = byDay.get(r.day);
    if (d) d[r.intensity] += r.n;
    byHour[r.hour].count += r.n;
    byIntensity[r.intensity - 1].count += r.n;
    odor.set(r.odor_type, (odor.get(r.odor_type) ?? 0) + r.n);
    reports += r.n;
    if (r.intensity >= 4) high += r.n;
    mergedExtra += r.extra;
  }

  const counts = Object.fromEntries(ev.map((e) => [e.name, e.n]));
  const started = counts.report_started ?? 0;
  const saved = counts.report_saved ?? 0;
  const mapViewed = counts.map_viewed ?? 0;
  const failures = fail[0].n;
  const ratio = (a: number, b: number) => (b > 0 ? Math.min(1, a / b) : null);

  return {
    range: { from, to: today, days },
    totals: {
      reports,
      high,
      merged_extra: mergedExtra,
      review: meta[0].review,
      location_failures: failures,
      has_demo: meta[0].has_demo,
    },
    by_day: [...byDay].map(([date, c]) => ({ date, counts: c })),
    by_hour: byHour,
    by_intensity: byIntensity,
    by_odor: [...odor]
      .filter(([, count]) => count > 0)
      .map(([odor_type, count]) => ({
        odor_type,
        label: (ODOR_TYPES as readonly string[]).includes(odor_type) ? ODOR_DISPLAY[odor_type as OdorType] : odor_type,
        count,
      }))
      .sort((a, b) => b.count - a.count),
    funnel: {
      started,
      saved,
      map_viewed: mapViewed,
      completion_rate: ratio(saved, started),
      gps_allow_rate: started > 0 ? Math.max(0, 1 - failures / started) : null,
      map_view_rate: ratio(mapViewed, saved),
    },
  };
}
