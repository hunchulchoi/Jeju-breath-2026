export const ODOR_TYPES = [
  "양돈",
  "계사",
  "우사",
  "퇴비",
  "액비",
  "음식물",
  "기타",
  "알 수 없음",
] as const;
export type OdorType = (typeof ODOR_TYPES)[number];

export function isOdorType(v: unknown): v is OdorType {
  return typeof v === "string" && (ODOR_TYPES as readonly string[]).includes(v);
}

// PRD 3.2 강도 기준
export const INTENSITY_LABELS: Record<number, { short: string; full: string }> = {
  1: { short: "살짝", full: "감지 취기" },
  2: { short: "보통", full: "보통 취기" },
  3: { short: "강함", full: "강한 취기" },
  4: { short: "극심", full: "극심한 취기" },
  5: { short: "참기 어려움", full: "참기 어려운 취기" },
};

export const INTENSITY_COLORS: Record<number, string> = {
  1: "#FDE68A",
  2: "#FDE68A",
  3: "#FB923C",
  4: "#DC2626",
  5: "#DC2626",
};
export const REVIEW_COLOR = "#9CA3AF";

/** 지도·목록에 공개하는 제보 (제보자 정보·원문 없음) */
export interface PublicReport {
  id: number;
  intensity: number;
  odor_type: OdorType;
  symptoms: string[];
  grid_lat: number;
  grid_lng: number;
  needs_review: boolean;
  merged_count: number;
  is_demo: boolean;
  reported_at: string;
  /** /api/photos/{id}로 볼 수 있는 사진. 확인 필요 제보는 항상 빈 배열 */
  photo_ids: number[];
}

export interface Summary {
  date: string;
  total: number;
  high_intensity: number;
  location_failures: number;
  has_demo: boolean;
}

/** 개인정보·위치정보 동의 문구 버전. 문구를 바꾸면 날짜를 올리고, 제보마다 이 값을 저장한다. */
export const CONSENT_VERSION = "2026-11-03";

/** 지도에 표시하는 대기질 측정소 (제주특별자치도 보건환경연구원). 위치는 읍·동 중심의 근사값 */
export interface AirStation {
  site: string;
  name: string;
  lat: number;
  lng: number;
  /** 위치가 근사값이면 true (주소를 정확히 찾지 못한 측정소) */
  approx: boolean;
  /** KST ISO, 예: 2026-11-03T21:00:00+09:00 */
  measured_at: string;
  /** 통합대기 등급 1 좋음 2 보통 3 나쁨 4 매우나쁨, 모르면 null */
  cai: 1 | 2 | 3 | 4 | null;
  rep_item: string | null;
  pm10: number | null;
  pm25: number | null;
  o3: number | null;
}

export const AIR_CAI_LABELS: Record<number, string> = { 1: "좋음", 2: "보통", 3: "나쁨", 4: "매우나쁨" };
export const AIR_UNKNOWN_LABEL = "정보 없음";
// 흰 글자 대비 4.5:1 이상 (좋음 6.7, 보통 5.0, 나쁨 4.9, 매우나쁨 6.5, 없음 4.8)
export const AIR_CAI_COLORS: Record<number, string> = { 1: "#1D4ED8", 2: "#15803D", 3: "#A16207", 4: "#B91C1C" };
export const AIR_UNKNOWN_COLOR = "#6B7280";
