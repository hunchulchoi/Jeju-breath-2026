import type { DB } from "./db";
import { hashUserId } from "./hash";
import { maskPersonalInfo } from "./mask";
import {
  RULES,
  checkLocation,
  checkSuspicious,
  distanceMeters,
  findDuplicate,
  toGrid,
  type LocationProblem,
  type PriorReport,
} from "./rules";
import { nextDay, seoulDay, toSeoulISO } from "./time";
import {
  isOdorType,
  type IntensitySource,
  type OdorType,
  type PublicReport,
  type Summary,
} from "./types";

export const MAX_TEXT_LENGTH = 500;

export function validateText(text: unknown): { ok: true; text: string } | { ok: false; error: string } {
  if (typeof text !== "string" || text.trim() === "") {
    return { ok: false, error: "냄새를 한 문장으로 적어 주세요." };
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return { ok: false, error: `${MAX_TEXT_LENGTH}자 이내로 적어 주세요.` };
  }
  return { ok: true, text: text.trim() };
}

export interface ReportInput {
  user_id: string;
  text: string;
  lat: number;
  lng: number;
  accuracy?: number;
  intensity: number;
  intensity_src: IntensitySource;
  odor_type: OdorType;
  symptoms: string[];
  confidence: number | null;
}

export type ParseResult =
  | { ok: true; input: ReportInput }
  | { ok: false; status: 400; error: string };

/** API 요청 본문을 검사한다. 위치 검사는 submitReport에서 따로 한다. */
export function parseReportBody(body: unknown): ParseResult {
  const bad = (error: string): ParseResult => ({ ok: false, status: 400, error });
  if (typeof body !== "object" || body === null) return bad("잘못된 요청이에요.");
  const b = body as Record<string, unknown>;

  if (typeof b.user_id !== "string" || b.user_id.length < 8 || b.user_id.length > 100) {
    return bad("user_id가 필요해요.");
  }
  const text = validateText(b.text);
  if (!text.ok) return bad(text.error);
  if (typeof b.lat !== "number" || typeof b.lng !== "number") {
    return bad("위치가 없어 저장하지 않았어요.");
  }
  const intensity = b.intensity;
  if (typeof intensity !== "number" || !Number.isInteger(intensity) || intensity < 1 || intensity > 5) {
    return bad("강도는 1-5 사이여야 해요.");
  }
  if (b.intensity_src !== "ai" && b.intensity_src !== "button") return bad("intensity_src가 잘못됐어요.");
  const symptoms = Array.isArray(b.symptoms)
    ? b.symptoms.filter((s): s is string => typeof s === "string").map((s) => s.slice(0, 40)).slice(0, 5)
    : [];
  const confidence =
    typeof b.confidence === "number" && b.confidence >= 0 && b.confidence <= 1 ? b.confidence : null;

  return {
    ok: true,
    input: {
      user_id: b.user_id,
      text: text.text,
      lat: b.lat,
      lng: b.lng,
      accuracy: typeof b.accuracy === "number" ? b.accuracy : undefined,
      intensity,
      intensity_src: b.intensity_src,
      odor_type: isOdorType(b.odor_type) ? b.odor_type : "알 수 없음",
      symptoms,
      confidence,
    },
  };
}

export type SubmitResult =
  | {
      ok: true;
      id: number;
      merged: boolean;
      needs_review: boolean;
      today_nearby_count: number;
      reported_at: string;
    }
  | { ok: false; problem: LocationProblem };

interface PriorRow {
  id: number;
  grid_lat: number;
  grid_lng: number;
  reported_at: string;
}

/** 위치 검사 → 중복 → 허위 의심 판정 → 저장. 원좌표는 판정 직후 지운다. */
export function submitReport(db: DB, input: ReportInput, now = new Date()): SubmitResult {
  const loc = checkLocation(input);
  if (!loc.ok) {
    recordLocationFailure(db, now);
    return { ok: false, problem: loc.problem };
  }
  const point = loc.point;
  const grid = toGrid(point);
  const userHash = hashUserId(input.user_id);
  const nowIso = toSeoulISO(now);
  const textMasked = maskPersonalInfo(input.text);
  const symptomsJson = JSON.stringify(input.symptoms);

  const run = db.transaction((): SubmitResult => {
    const since = toSeoulISO(new Date(now.getTime() - 60 * 60_000));
    const rows = db
      .prepare(
        `SELECT id, grid_lat, grid_lng, reported_at FROM reports
         WHERE user_hash = ? AND reported_at >= ? AND reported_at <= ?`,
      )
      .all(userHash, since, nowIso) as PriorRow[];
    const priors: PriorReport[] = rows.map((r) => ({
      id: r.id,
      point: { lat: r.grid_lat, lng: r.grid_lng },
      reportedAt: new Date(r.reported_at),
    }));

    const dup = findDuplicate(point, now, priors);
    if (dup) {
      // 나중 제보로 강도·종류·증상을 갱신하고 1건으로 묶는다
      db.prepare(
        `UPDATE reports SET intensity = ?, intensity_src = ?, odor_type = ?, symptoms = ?,
           confidence = ?, text_masked = ?, merged_count = merged_count + 1
         WHERE id = ?`,
      ).run(input.intensity, input.intensity_src, input.odor_type, symptomsJson, input.confidence, textMasked, dup.id);
      const row = db.prepare(`SELECT needs_review, reported_at FROM reports WHERE id = ?`).get(dup.id) as {
        needs_review: number;
        reported_at: string;
      };
      return {
        ok: true,
        id: dup.id,
        merged: true,
        needs_review: row.needs_review === 1,
        today_nearby_count: countNearbyToday(db, point, now, dup.id),
        reported_at: row.reported_at,
      };
    }

    const needsReview = checkSuspicious(point, now, priors) !== null;
    const info = db
      .prepare(
        `INSERT INTO reports (user_hash, text_masked, intensity, intensity_src, odor_type, symptoms,
           confidence, grid_lat, grid_lng, raw_lat, raw_lng, needs_review, reported_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        userHash,
        textMasked,
        input.intensity,
        input.intensity_src,
        input.odor_type,
        symptomsJson,
        input.confidence,
        grid.lat,
        grid.lng,
        point.lat,
        point.lng,
        needsReview ? 1 : 0,
        nowIso,
      );
    const id = Number(info.lastInsertRowid);
    // 판정이 끝났으므로 원좌표 삭제 (PRD 3.5)
    db.prepare(`UPDATE reports SET raw_lat = NULL, raw_lng = NULL WHERE id = ?`).run(id);

    return {
      ok: true,
      id,
      merged: false,
      needs_review: needsReview,
      today_nearby_count: countNearbyToday(db, point, now, id),
      reported_at: nowIso,
    };
  });

  const result = run();
  if (result.ok) bumpEvent(db, "report_saved", now);
  return result;
}

/** 오늘, 반경 1km 안의 다른 제보 수 (확인 필요 제외) */
function countNearbyToday(db: DB, point: { lat: number; lng: number }, now: Date, excludeId: number): number {
  const day = seoulDay(now);
  const rows = db
    .prepare(
      `SELECT grid_lat, grid_lng FROM reports
       WHERE reported_at >= ? AND reported_at < ? AND needs_review = 0 AND id != ?`,
    )
    .all(day, nextDay(day), excludeId) as { grid_lat: number; grid_lng: number }[];
  return rows.filter((r) => distanceMeters(point, { lat: r.grid_lat, lng: r.grid_lng }) <= RULES.nearbyMeters)
    .length;
}

export function recordLocationFailure(db: DB, now = new Date()): void {
  db.prepare(
    `INSERT INTO location_failures (day, count) VALUES (?, 1)
     ON CONFLICT(day) DO UPDATE SET count = count + 1`,
  ).run(seoulDay(now));
}

export const EVENT_NAMES = ["report_started", "report_saved", "map_viewed"] as const;
export type EventName = (typeof EVENT_NAMES)[number];

export function bumpEvent(db: DB, name: EventName, now = new Date()): void {
  db.prepare(
    `INSERT INTO event_counts (day, name, count) VALUES (?, ?, 1)
     ON CONFLICT(day, name) DO UPDATE SET count = count + 1`,
  ).run(seoulDay(now), name);
}

interface ReportRow {
  id: number;
  intensity: number;
  odor_type: OdorType;
  symptoms: string;
  grid_lat: number;
  grid_lng: number;
  needs_review: number;
  merged_count: number;
  is_demo: number;
  reported_at: string;
}

/** 지도·목록용 제보. 격자 좌표만, 제보자 해시·원문 제외. */
export function listReports(db: DB, day: string): PublicReport[] {
  const rows = db
    .prepare(
      `SELECT id, intensity, odor_type, symptoms, grid_lat, grid_lng, needs_review, merged_count,
              is_demo, reported_at
       FROM reports WHERE reported_at >= ? AND reported_at < ? ORDER BY reported_at DESC`,
    )
    .all(day, nextDay(day)) as ReportRow[];
  return rows.map((r) => ({
    id: r.id,
    intensity: r.intensity,
    odor_type: r.odor_type,
    symptoms: safeJsonArray(r.symptoms),
    grid_lat: r.grid_lat,
    grid_lng: r.grid_lng,
    needs_review: r.needs_review === 1,
    merged_count: r.merged_count,
    is_demo: r.is_demo === 1,
    reported_at: r.reported_at,
  }));
}

function safeJsonArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function getSummary(db: DB, day: string): Summary {
  const r = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN needs_review = 0 THEN 1 ELSE 0 END), 0) AS total,
         COALESCE(SUM(CASE WHEN needs_review = 0 AND intensity >= 4 THEN 1 ELSE 0 END), 0) AS high,
         COALESCE(MAX(is_demo), 0) AS has_demo
       FROM reports WHERE reported_at >= ? AND reported_at < ?`,
    )
    .get(day, nextDay(day)) as { total: number; high: number; has_demo: number };
  const f = db.prepare(`SELECT count FROM location_failures WHERE day = ?`).get(day) as
    | { count: number }
    | undefined;
  return {
    date: day,
    total: r.total,
    high_intensity: r.high,
    location_failures: f?.count ?? 0,
    has_demo: r.has_demo === 1,
  };
}

export interface Metrics {
  date: string;
  started: number;
  saved: number;
  location_failures: number;
  map_viewed: number;
  completion_rate: number | null;
  gps_allow_rate: number | null;
  map_view_rate: number | null;
}

/** PoC 지표 (PRD 12장). 시도가 0이면 비율은 null. */
export function getMetrics(db: DB, day: string): Metrics {
  const counts = Object.fromEntries(
    (db.prepare(`SELECT name, count FROM event_counts WHERE day = ?`).all(day) as {
      name: string;
      count: number;
    }[]).map((r) => [r.name, r.count]),
  );
  const started = counts.report_started ?? 0;
  const saved = counts.report_saved ?? 0;
  const mapViewed = counts.map_viewed ?? 0;
  const failures = getSummary(db, day).location_failures;
  const ratio = (a: number, b: number) => (b > 0 ? Math.min(1, a / b) : null);
  return {
    date: day,
    started,
    saved,
    location_failures: failures,
    map_viewed: mapViewed,
    completion_rate: ratio(saved, started),
    gps_allow_rate: started > 0 ? Math.max(0, 1 - failures / started) : null,
    map_view_rate: ratio(mapViewed, saved),
  };
}
