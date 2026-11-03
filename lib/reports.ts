import type { DB, Queryable } from "./db";
import { consumeDraft, isDraftToken } from "./kakao";
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
import { dayRange, seoulDay, toSeoulISO } from "./time";
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
  /** 브라우저가 만든 ID. user_hash가 있으면 쓰지 않는다 */
  user_id?: string;
  /** 이미 해시된 제보자 값 (카카오 초안 경로) */
  user_hash?: string;
  /** 카카오 초안 token (파싱 결과일 뿐, 소비는 submitReport 옵션으로 한다) */
  draft_token?: string;
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

  let draftToken: string | undefined;
  let userId: string | undefined;
  let textValue = "";
  if (b.draft_token !== undefined) {
    // 초안 경로: 제보자와 문장은 서버의 초안 값을 쓰므로 본문 값은 무시한다
    if (!isDraftToken(b.draft_token)) return bad("잘못된 요청이에요.");
    draftToken = b.draft_token;
  } else {
    if (typeof b.user_id !== "string" || b.user_id.length < 8 || b.user_id.length > 100) {
      return bad("user_id가 필요해요.");
    }
    const text = validateText(b.text);
    if (!text.ok) return bad(text.error);
    userId = b.user_id;
    textValue = text.text;
  }
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
      user_id: userId,
      draft_token: draftToken,
      text: textValue,
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
  | { ok: false; problem: LocationProblem }
  | { ok: false; problem: "draft_used" };

class DraftUsedError extends Error {}

export interface SubmitOptions {
  /** 저장과 같은 트랜잭션에서 소비할 카카오 초안 token */
  consumeDraftToken?: string;
}

/** 위치 검사 → 중복 → 허위 의심 판정 → 저장. 원좌표는 판정 직후 지운다. */
export async function submitReport(
  db: DB,
  input: ReportInput,
  now?: Date,
  options: SubmitOptions = {},
): Promise<SubmitResult> {
  const loc = checkLocation(input);
  if (!loc.ok) {
    await recordLocationFailure(db, now ?? new Date());
    return { ok: false, problem: loc.problem };
  }
  const point = loc.point;
  const grid = toGrid(point);
  const userHash = input.user_hash ?? (input.user_id ? hashUserId(input.user_id) : null);
  if (!userHash) throw new Error("user_id 또는 user_hash가 필요해요.");
  const textMasked = maskPersonalInfo(input.text);
  const symptomsJson = JSON.stringify(input.symptoms);

  let at = now ?? new Date();
  let result: SubmitResult;
  try {
    result = await db.tx(async (q): Promise<SubmitResult> => {
    // 같은 제보자의 동시 요청이 중복 판정을 함께 빠져나가지 않도록 제보자 단위로 잠근다
    await q.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [userHash]);
    // 시각은 잠금을 얻은 뒤에 정한다. 먼저 시작했지만 늦게 잠근 요청도 앞선 요청의 행을 본다.
    at = now ?? new Date();
    // 초안은 저장과 같은 트랜잭션에서 소비한다. 동시에 쓰였으면 롤백한다.
    if (options.consumeDraftToken && !(await consumeDraft(q, options.consumeDraftToken, at))) {
      throw new DraftUsedError();
    }
    const since = new Date(at.getTime() - 60 * 60_000);
    const { rows } = await q.query<{ id: number; grid_lat: number; grid_lng: number; reported_at: Date }>(
      `SELECT id, grid_lat, grid_lng, reported_at FROM reports
       WHERE user_hash = $1 AND reported_at >= $2`,
      [userHash, since],
    );
    const priors: PriorReport[] = rows.map((r) => ({
      id: r.id,
      point: { lat: r.grid_lat, lng: r.grid_lng },
      reportedAt: new Date(r.reported_at),
    }));

    const dup = findDuplicate(point, at, priors);
    if (dup) {
      // 나중 제보로 강도·종류·증상을 갱신하고 1건으로 묶는다
      const { rows: updated } = await q.query<{ needs_review: boolean; reported_at: Date }>(
        `UPDATE reports SET intensity = $1, intensity_src = $2, odor_type = $3, symptoms = $4::jsonb,
           confidence = $5, text_masked = $6, merged_count = merged_count + 1
         WHERE id = $7
         RETURNING needs_review, reported_at`,
        [input.intensity, input.intensity_src, input.odor_type, symptomsJson, input.confidence, textMasked, dup.id],
      );
      return {
        ok: true,
        id: dup.id,
        merged: true,
        needs_review: updated[0].needs_review,
        today_nearby_count: await countNearbyToday(q, point, at, dup.id),
        reported_at: toSeoulISO(new Date(updated[0].reported_at)),
      };
    }

    const needsReview = checkSuspicious(point, at, priors) !== null;
    const { rows: inserted } = await q.query<{ id: number }>(
      `INSERT INTO reports (user_hash, text_masked, intensity, intensity_src, odor_type, symptoms,
         confidence, grid_lat, grid_lng, raw_lat, raw_lng, needs_review, reported_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id`,
      [
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
        needsReview,
        at,
      ],
    );
    const id = inserted[0].id;
    // 판정이 끝났으므로 원좌표 삭제 (PRD 3.5)
    await q.query(`UPDATE reports SET raw_lat = NULL, raw_lng = NULL WHERE id = $1`, [id]);

    return {
      ok: true,
      id,
      merged: false,
      needs_review: needsReview,
      today_nearby_count: await countNearbyToday(q, point, at, id),
      reported_at: toSeoulISO(at),
    };
    });
  } catch (e) {
    if (e instanceof DraftUsedError) return { ok: false, problem: "draft_used" };
    throw e;
  }

  if (result.ok) {
    // 제보는 이미 저장됐으므로 지표 기록 실패가 저장 실패로 보이면 안 된다
    try {
      await bumpEvent(db, "report_saved", at);
    } catch (e) {
      console.error("[metrics] 이벤트 기록 실패", (e as Error).name);
    }
  }
  return result;
}

/** 오늘, 반경 1km 안의 다른 제보 수 (확인 필요 제외) */
async function countNearbyToday(
  q: Queryable,
  point: { lat: number; lng: number },
  now: Date,
  excludeId: number,
): Promise<number> {
  const [from, to] = dayRange(seoulDay(now));
  const { rows } = await q.query<{ grid_lat: number; grid_lng: number }>(
    `SELECT grid_lat, grid_lng FROM reports
     WHERE reported_at >= $1 AND reported_at < $2 AND needs_review = FALSE AND id != $3`,
    [from, to, excludeId],
  );
  return rows.filter((r) => distanceMeters(point, { lat: r.grid_lat, lng: r.grid_lng }) <= RULES.nearbyMeters)
    .length;
}

export async function recordLocationFailure(db: Queryable, now = new Date()): Promise<void> {
  await db.query(
    `INSERT INTO location_failures (day, count) VALUES ($1, 1)
     ON CONFLICT (day) DO UPDATE SET count = location_failures.count + 1`,
    [seoulDay(now)],
  );
}

export const EVENT_NAMES = ["report_started", "report_saved", "map_viewed"] as const;
export type EventName = (typeof EVENT_NAMES)[number];

export async function bumpEvent(db: Queryable, name: EventName, now = new Date()): Promise<void> {
  await db.query(
    `INSERT INTO event_counts (day, name, count) VALUES ($1, $2, 1)
     ON CONFLICT (day, name) DO UPDATE SET count = event_counts.count + 1`,
    [seoulDay(now), name],
  );
}

interface ReportRow {
  id: number;
  intensity: number;
  odor_type: OdorType;
  symptoms: unknown;
  grid_lat: number;
  grid_lng: number;
  needs_review: boolean;
  merged_count: number;
  is_demo: boolean;
  reported_at: Date;
  photo_ids: number[] | null;
}

/** 지도·목록용 제보. 격자 좌표만, 제보자 해시·원문 제외. 확인 필요 제보는 사진을 내보내지 않는다. */
export async function listReports(db: Queryable, day: string): Promise<PublicReport[]> {
  const [from, to] = dayRange(day);
  const { rows } = await db.query<ReportRow>(
    `SELECT r.id, r.intensity, r.odor_type, r.symptoms, r.grid_lat, r.grid_lng, r.needs_review,
            r.merged_count, r.is_demo, r.reported_at,
            CASE WHEN r.needs_review THEN NULL
                 ELSE (SELECT array_agg(p.id ORDER BY p.id) FROM report_photos p WHERE p.report_id = r.id AND p.uploaded)
            END AS photo_ids
     FROM reports r
     WHERE r.reported_at >= $1 AND r.reported_at < $2
     ORDER BY r.reported_at DESC, r.id DESC`,
    [from, to],
  );
  return rows.map((r) => ({
    id: r.id,
    intensity: r.intensity,
    odor_type: r.odor_type,
    symptoms: stringArray(r.symptoms),
    grid_lat: r.grid_lat,
    grid_lng: r.grid_lng,
    needs_review: r.needs_review,
    merged_count: r.merged_count,
    is_demo: r.is_demo,
    reported_at: toSeoulISO(new Date(r.reported_at)),
    photo_ids: r.photo_ids ?? [],
  }));
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export async function getSummary(db: Queryable, day: string): Promise<Summary> {
  const [from, to] = dayRange(day);
  const { rows } = await db.query<{ total: number; high: number; has_demo: boolean }>(
    `SELECT
       COUNT(*) FILTER (WHERE NOT needs_review)::int AS total,
       COUNT(*) FILTER (WHERE NOT needs_review AND intensity >= 4)::int AS high,
       COALESCE(BOOL_OR(is_demo), FALSE) AS has_demo
     FROM reports WHERE reported_at >= $1 AND reported_at < $2`,
    [from, to],
  );
  const { rows: f } = await db.query<{ count: number }>(`SELECT count FROM location_failures WHERE day = $1`, [day]);
  return {
    date: day,
    total: rows[0].total,
    high_intensity: rows[0].high,
    location_failures: f[0]?.count ?? 0,
    has_demo: rows[0].has_demo,
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
export async function getMetrics(db: Queryable, day: string): Promise<Metrics> {
  const { rows } = await db.query<{ name: string; count: number }>(
    `SELECT name, count FROM event_counts WHERE day = $1`,
    [day],
  );
  const counts = Object.fromEntries(rows.map((r) => [r.name, r.count]));
  const started = counts.report_started ?? 0;
  const saved = counts.report_saved ?? 0;
  const mapViewed = counts.map_viewed ?? 0;
  const failures = (await getSummary(db, day)).location_failures;
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
