import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CONSENT_VERSION } from "@/lib/types";
import { testDb } from "./pg";
import { getMetrics, getSummary, listReports, parseReportBody, submitReport, bumpEvent, type ReportInput } from "@/lib/reports";

const AEWOL = { lat: 33.4625, lng: 126.3305 };
const base: ReportInput = {
  user_id: "11111111-2222-3333-4444-555555555555",
  ...AEWOL,
  accuracy: 20,
  intensity: 4,
  odor_type: "양돈",
  consent_version: CONSENT_VERSION,
};
const at = (hhmm: string) => new Date(`2026-11-03T${hhmm}:00+09:00`);
let db: Awaited<ReturnType<typeof testDb>>;
beforeAll(async () => {
  db = await testDb();
});
afterAll(() => db.close());
beforeEach(() => db.reset());

const count = async () => (await db.query<{ c: number }>("SELECT COUNT(*)::int c FROM reports")).rows[0].c;
const one = async <T,>(sql: string) => (await db.query<T>(sql)).rows[0];

describe("parseReportBody: 동의·본문", () => {
  const CONSENT = "개인정보·위치정보 동의가 필요해요.";
  it("consent_version이 없으면 400", () => {
    const { consent_version: _c, ...rest } = base;
    expect(parseReportBody(rest)).toEqual({ ok: false, status: 400, error: CONSENT });
  });
  it("consent_version이 다르면 400", () => {
    expect(parseReportBody({ ...base, consent_version: "1999-01-01" })).toEqual({ ok: false, status: 400, error: CONSENT });
  });
  it("text·symptoms·confidence·intensity_src·draft_token은 무시한다", () => {
    const r = parseReportBody({ ...base, text: "냄새", symptoms: ["a"], confidence: 0.9, intensity_src: "ai", draft_token: "x" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.input).sort()).toEqual(
      ["accuracy", "consent_version", "intensity", "lat", "lng", "odor_type", "user_id"],
    );
  });
  it("odor_type이 없거나 이상하면 알 수 없음", () => {
    expect(parseReportBody({ ...base, odor_type: "???" })).toMatchObject({ ok: true, input: { odor_type: "알 수 없음" } });
    expect(parseReportBody({ ...base, odor_type: undefined })).toMatchObject({ ok: true, input: { odor_type: "알 수 없음" } });
  });
});

describe("FR-2: 위치 없으면 저장하지 않음", () => {
  it("API 본문에 lat/lng 없으면 400", async () => {
    const { lat: _lat, lng: _lng, ...noLoc } = base;
    expect(parseReportBody(noLoc)).toMatchObject({ ok: false, status: 400 });
  });

  it("제주 밖 좌표는 행이 생기지 않고 실패 카운트만 +1", async () => {
    const r = await submitReport(db, { ...base, lat: 37.56, lng: 126.97 }, at("19:00"));
    expect(r).toEqual({ ok: false, problem: "out_of_bounds" });
    expect(await count()).toBe(0);
    expect((await getSummary(db, "2026-11-03")).location_failures).toBe(1);
  });
});

describe("FR-5: 저장과 중복", () => {
  it("저장 후 원좌표는 지우고 격자 좌표만 남긴다", async () => {
    const r = await submitReport(db, base, at("19:00"));
    expect(r.ok).toBe(true);
    const row = await one<Record<string, unknown>>("SELECT * FROM reports");
    expect(row.raw_lat).toBeNull();
    expect(row.raw_lng).toBeNull();
    expect(row.grid_lat).not.toBe(AEWOL.lat);
    expect(row.user_hash).not.toContain(base.user_id);
    expect((row.reported_at as Date).toISOString()).toBe("2026-11-03T10:00:00.000Z");
    expect(r).toMatchObject({ reported_at: "2026-11-03T19:00:00+09:00" });
  });

  it("같은 사용자가 30분 내 300m 내 두 번 제보하면 1건만 남고 강도는 나중 값", async () => {
    await submitReport(db, base, at("19:00"));
    const second = await submitReport(db, { ...base, lat: AEWOL.lat + 0.001, intensity: 5 }, at("19:20"));
    expect(second).toMatchObject({ ok: true, merged: true });
    expect(await count()).toBe(1);
    const row = await one("SELECT intensity, merged_count FROM reports");
    expect(row).toEqual({ intensity: 5, merged_count: 2 });
  });

  it("동시 요청 순서가 뒤바뀌어 이전 행이 1초 뒤 시각이어도 합친다", async () => {
    await submitReport(db, base, new Date("2026-11-03T19:00:01+09:00"));
    const r = await submitReport(db, base, new Date("2026-11-03T19:00:00+09:00"));
    expect(r).toMatchObject({ ok: true, merged: true });
    expect(await count()).toBe(1);
  });

  it("지표 기록이 실패해도 제보 저장 결과는 성공", async () => {
    const wrapped = {
      ...db,
      query: (sql: string, params?: unknown[]) => {
        if (sql.includes("INSERT INTO event_counts")) return Promise.reject(new Error("boom"));
        return db.query(sql, params);
      },
    } as unknown as typeof db;
    const r = await submitReport(wrapped, base, at("19:00"));
    expect(r).toMatchObject({ ok: true });
    expect(await count()).toBe(1);
  });

  it("다른 사용자는 같은 자리여도 따로 저장", async () => {
    await submitReport(db, base, at("19:00"));
    const other = await submitReport(db, { ...base, user_id: "99999999-2222-3333-4444-555555555555" }, at("19:05"));
    expect(other).toMatchObject({ ok: true, merged: false, today_nearby_count: 1 });
    expect(await count()).toBe(2);
  });

  it("10분 안에 5km 넘게 이동하면 저장하되 확인 필요, 요약에서 제외", async () => {
    await submitReport(db, base, at("19:00"));
    const far = await submitReport(db, { ...base, lat: AEWOL.lat - 0.06 }, at("19:05"));
    expect(far).toMatchObject({ ok: true, needs_review: true });
    expect(await count()).toBe(2);
    expect(await getSummary(db, "2026-11-03")).toMatchObject({ total: 1, high_intensity: 1 });
  });

  it("text를 보내도 저장하지 않고 동의 버전과 button 출처를 기록한다", async () => {
    const parsed = parseReportBody({ ...base, text: "냄새 심해요 010-1234-5678" });
    if (!parsed.ok) throw new Error("parse");
    await submitReport(db, parsed.input, at("19:00"));
    const row = await one<{ text_masked: string | null; consent_version: string; intensity_src: string }>(
      "SELECT text_masked, consent_version, intensity_src FROM reports",
    );
    expect(row).toEqual({ text_masked: null, consent_version: CONSENT_VERSION, intensity_src: "button" });
    expect(JSON.stringify((await db.query("SELECT * FROM reports")).rows)).not.toContain("1234");
  });
});

describe("목록·요약·지표", () => {
  it("목록에는 제보자 해시와 원문이 없다", async () => {
    await submitReport(db, base, at("19:00"));
    const [r] = await listReports(db, "2026-11-03");
    expect(r).not.toHaveProperty("user_hash");
    expect(r).not.toHaveProperty("text_masked");
    expect(r.symptoms).toEqual([]);
  });

  it("다른 날짜 제보는 섞이지 않는다", async () => {
    await submitReport(db, base, at("23:59"));
    await submitReport(db, { ...base, user_id: "x".repeat(10) }, new Date("2026-11-04T00:01:00+09:00"));
    expect(await listReports(db, "2026-11-03")).toHaveLength(1);
    expect(await listReports(db, "2026-11-04")).toHaveLength(1);
  });

  it("지표: 시작 4, 저장 3, 위치 실패 1", async () => {
    for (let i = 0; i < 4; i++) await bumpEvent(db, "report_started", at("19:00"));
    await submitReport(db, base, at("19:00"));
    await submitReport(db, { ...base, user_id: "b".repeat(10) }, at("19:01"));
    await submitReport(db, { ...base, user_id: "c".repeat(10) }, at("19:02"));
    await submitReport(db, { ...base, user_id: "d".repeat(10), accuracy: 900 }, at("19:03"));
    const m = await getMetrics(db, "2026-11-03");
    expect(m).toMatchObject({ started: 4, saved: 3, location_failures: 1, completion_rate: 0.75, gps_allow_rate: 0.75 });
  });
});
