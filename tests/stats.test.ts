import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testDb } from "./pg";
import { getStats, parseStatsDays } from "@/lib/stats";

let db: Awaited<ReturnType<typeof testDb>>;
beforeAll(async () => {
  db = await testDb();
});
afterAll(() => db.close());
beforeEach(() => db.reset());

async function add(
  at: string,
  o: { intensity?: number; odor?: string; review?: boolean; merged?: number; demo?: boolean } = {},
) {
  await db.query(
    `INSERT INTO reports (user_hash, intensity, intensity_src, odor_type, grid_lat, grid_lng, needs_review, merged_count, is_demo, reported_at)
     VALUES ('h', $1, 'button', $2, 33.46, 126.33, $3, $4, $5, $6)`,
    [o.intensity ?? 3, o.odor ?? "양돈", o.review ?? false, o.merged ?? 1, o.demo ?? false, at],
  );
}

const TODAY = "2026-11-03";

describe("getStats", () => {
  it("기간은 오늘 포함 days일이고 서울 자정이 경계다", async () => {
    await add("2026-11-02T23:59:59+09:00"); // 1일 기간 밖
    await add("2026-11-03T00:00:00+09:00"); // 안
    await add("2026-11-03T23:59:59+09:00"); // 안
    await add("2026-11-04T00:00:00+09:00"); // 밖
    const s1 = await getStats(db, { days: 1, today: TODAY });
    expect(s1.range).toEqual({ from: "2026-11-03", to: "2026-11-03", days: 1 });
    expect(s1.totals.reports).toBe(2);
    const s7 = await getStats(db, { days: 7, today: TODAY });
    expect(s7.range.from).toBe("2026-10-28");
    expect(s7.totals.reports).toBe(3);
  });

  it("시간대는 UTC가 아니라 서울 시각 기준", async () => {
    await add("2026-11-02T15:30:00Z"); // 서울 11/3 00:30
    await add("2026-11-03T14:10:00Z"); // 서울 11/3 23:10
    const s = await getStats(db, { days: 1, today: TODAY });
    expect(s.by_hour[0].count).toBe(1);
    expect(s.by_hour[23].count).toBe(1);
    expect(s.by_hour).toHaveLength(24);
    expect(s.by_day[0].date).toBe(TODAY);
  });

  it("needs_review는 집계에서 빼고 개수만 센다", async () => {
    await add("2026-11-03T10:00:00+09:00", { intensity: 5 });
    await add("2026-11-03T11:00:00+09:00", { intensity: 5, review: true });
    const s = await getStats(db, { days: 1, today: TODAY });
    expect(s.totals).toMatchObject({ reports: 1, high: 1, review: 1 });
    expect(s.by_intensity[4].count).toBe(1);
    expect(s.by_odor).toEqual([{ odor_type: "양돈", label: "돼지 축사", count: 1 }]);
  });

  it("merged_extra는 SUM(merged_count-1)", async () => {
    await add("2026-11-03T10:00:00+09:00", { merged: 3 });
    await add("2026-11-03T11:00:00+09:00", { merged: 1 });
    await add("2026-11-03T12:00:00+09:00", { merged: 2, review: true });
    const s = await getStats(db, { days: 1, today: TODAY });
    expect(s.totals.merged_extra).toBe(2);
  });

  it("제보 없는 날도 0으로 채우고 강도별로 쌓는다", async () => {
    await add("2026-11-01T10:00:00+09:00", { intensity: 2 });
    await add("2026-11-01T11:00:00+09:00", { intensity: 2 });
    await add("2026-11-03T10:00:00+09:00", { intensity: 4, demo: true });
    const s = await getStats(db, { days: 7, today: TODAY });
    expect(s.by_day.map((d) => d.date)).toEqual([
      "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03",
    ]);
    expect(s.by_day[4].counts).toEqual({ 1: 0, 2: 2, 3: 0, 4: 0, 5: 0 });
    expect(s.by_day[5].counts).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
    expect(s.by_day[6].counts[4]).toBe(1);
    expect(s.totals.has_demo).toBe(true);
  });

  it("냄새 종류는 건수 내림차순, 0은 제외", async () => {
    await add("2026-11-03T10:00:00+09:00", { odor: "퇴비" });
    await add("2026-11-03T11:00:00+09:00", { odor: "양돈" });
    await add("2026-11-03T12:00:00+09:00", { odor: "양돈" });
    const s = await getStats(db, { days: 1, today: TODAY });
    expect(s.by_odor.map((o) => [o.odor_type, o.count])).toEqual([["양돈", 2], ["퇴비", 1]]);
  });

  it("참여 지표는 기간 합, 시작 0이면 비율 null", async () => {
    let s = await getStats(db, { days: 7, today: TODAY });
    expect(s.funnel).toEqual({
      started: 0, saved: 0, map_viewed: 0, completion_rate: null, gps_allow_rate: null, map_view_rate: null,
    });
    await db.query(
      `INSERT INTO event_counts (day, name, count) VALUES
       ('2026-11-03','report_started',6),('2026-11-01','report_started',4),
       ('2026-11-03','report_saved',5),('2026-10-01','report_saved',99),
       ('2026-11-02','map_viewed',10)`,
    );
    await db.query(`INSERT INTO location_failures (day, count) VALUES ('2026-11-03', 1), ('2026-11-02', 1)`);
    s = await getStats(db, { days: 7, today: TODAY });
    expect(s.funnel.started).toBe(10);
    expect(s.funnel.saved).toBe(5);
    expect(s.funnel.completion_rate).toBe(0.5);
    expect(s.funnel.gps_allow_rate).toBe(0.8);
    expect(s.funnel.map_view_rate).toBe(1);
    expect(s.totals.location_failures).toBe(2);
    s = await getStats(db, { days: 1, today: TODAY });
    expect(s.funnel).toMatchObject({ started: 6, saved: 5, map_viewed: 0 });
    expect(s.totals.location_failures).toBe(1);
  });
});

describe("parseStatsDays", () => {
  it("1·7·30만 허용, 없으면 7", () => {
    expect(parseStatsDays(null)).toBe(7);
    expect(parseStatsDays("1")).toBe(1);
    expect(parseStatsDays("30")).toBe(30);
    for (const v of ["0", "2", "31", "abc", ""]) expect(parseStatsDays(v)).toBeNull();
  });
});
