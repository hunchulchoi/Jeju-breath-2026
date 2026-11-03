// 위치·중복·허위 판정 규칙 (AI 미사용). 숫자 기준은 PRD 3.1, 3.4의 [가설] 값.

export const RULES = {
  gridMeters: 200,
  maxAccuracyMeters: 200,
  duplicateMinutes: 30,
  duplicateMeters: 300,
  jumpMinutes: 10,
  jumpMeters: 5000,
  hourlyLimit: 5,
  nearbyMeters: 1000,
} as const;

// 제주도 경계 박스 (PRD 3.1 [권장])
export const JEJU_BOUNDS = { minLat: 33.1, maxLat: 33.6, minLng: 126.1, maxLng: 127.0 };

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function isInJeju({ lat, lng }: LatLng): boolean {
  return (
    lat >= JEJU_BOUNDS.minLat &&
    lat <= JEJU_BOUNDS.maxLat &&
    lng >= JEJU_BOUNDS.minLng &&
    lng <= JEJU_BOUNDS.maxLng
  );
}

export type LocationProblem = "missing" | "out_of_bounds" | "low_accuracy";

export function checkLocation(input: {
  lat?: unknown;
  lng?: unknown;
  accuracy?: unknown;
}): { ok: true; point: LatLng } | { ok: false; problem: LocationProblem } {
  const { lat, lng, accuracy } = input;
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return { ok: false, problem: "missing" };
  }
  if (!isInJeju({ lat, lng })) return { ok: false, problem: "out_of_bounds" };
  if (typeof accuracy === "number" && accuracy > RULES.maxAccuracyMeters) {
    return { ok: false, problem: "low_accuracy" };
  }
  return { ok: true, point: { lat, lng } };
}

// 격자 간격은 제주 중심 위도(33.4°) 기준으로 고정해 같은 칸이 항상 같은 좌표가 되게 한다.
const METERS_PER_DEG_LAT = 111_320;
const GRID_REF_LAT = 33.4;
const LAT_STEP = RULES.gridMeters / METERS_PER_DEG_LAT;
const LNG_STEP = RULES.gridMeters / (METERS_PER_DEG_LAT * Math.cos(toRad(GRID_REF_LAT)));

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** 약 200m 격자의 중심점으로 바꾼다 (근사 위치). */
export function toGrid({ lat, lng }: LatLng): LatLng {
  return {
    lat: round6((Math.floor(lat / LAT_STEP) + 0.5) * LAT_STEP),
    lng: round6((Math.floor(lng / LNG_STEP) + 0.5) * LNG_STEP),
  };
}

/** 같은 제보자의 이전 제보. 원좌표는 판정 직후 지우므로 격자 좌표로 비교한다. */
export interface PriorReport {
  id: number;
  point: LatLng;
  reportedAt: Date;
}

const minutesBetween = (a: Date, b: Date) => Math.abs(a.getTime() - b.getTime()) / 60_000;

/** 30분·300m 안의 가장 최근 제보를 찾는다. 있으면 그 제보로 합친다. */
export function findDuplicate(
  point: LatLng,
  now: Date,
  priors: PriorReport[],
): PriorReport | null {
  const candidates = priors
    .filter(
      (p) =>
        minutesBetween(now, p.reportedAt) <= RULES.duplicateMinutes &&
        distanceMeters(point, p.point) <= RULES.duplicateMeters,
    )
    .sort((a, b) => b.reportedAt.getTime() - a.reportedAt.getTime());
  return candidates[0] ?? null;
}

export type ReviewReason = "impossible_move" | "too_many";

/** 10분 안에 5km 이상 이동, 또는 1시간 안에 5건 초과면 '확인 필요'. */
export function checkSuspicious(
  point: LatLng,
  now: Date,
  priors: PriorReport[],
): ReviewReason | null {
  // 동시 요청 순서가 바뀌면 이전 제보 시각이 now보다 살짝 뒤일 수 있어 절댓값으로 본다
  const past = priors;
  const jumped = past.some(
    (p) =>
      minutesBetween(now, p.reportedAt) <= RULES.jumpMinutes &&
      distanceMeters(point, p.point) >= RULES.jumpMeters,
  );
  if (jumped) return "impossible_move";
  const lastHour = past.filter((p) => minutesBetween(now, p.reportedAt) <= 60).length;
  if (lastHour + 1 > RULES.hourlyLimit) return "too_many";
  return null;
}
