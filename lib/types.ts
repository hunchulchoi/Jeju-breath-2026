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
  1: { short: "살짝 나요", full: "냄새가 나는 걸 겨우 알겠어요" },
  2: { short: "냄새가 나요", full: "무슨 냄새인지 알겠어요" },
  3: { short: "심해요", full: "냄새가 확 느껴져요" },
  4: { short: "아주 심해요", full: "창문을 닫아야 할 정도예요" },
  5: { short: "못 참겠어요", full: "숨쉬기 힘들 정도예요" },
};

// 지도 마커·범례·강도 버튼이 함께 쓰는 색. 글자색(INTENSITY_TEXT)과의 대비는 모두 4.5:1 이상
// (1 흰/#15803D 5.02, 2 진한/#FACC15 9.60, 3 진한/#FDBA74 8.71, 4 흰/#C2410C 5.18, 5 흰/#DC2626 4.83)
export const INTENSITY_COLORS: Record<number, string> = {
  1: "#15803D",
  2: "#FACC15",
  3: "#FDBA74",
  4: "#C2410C",
  5: "#DC2626",
};
export const INTENSITY_TEXT: Record<number, string> = {
  1: "#FFFFFF",
  2: "#1F2A2E",
  3: "#1F2A2E",
  4: "#FFFFFF",
  5: "#FFFFFF",
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
