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

export const CONFIDENCE_THRESHOLD = 0.7;

export type IntensitySource = "ai" | "button";

export interface Extraction {
  intensity: number | null;
  odor_type: OdorType;
  symptoms: string[];
  confidence: number;
}

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
}

export interface Summary {
  date: string;
  total: number;
  high_intensity: number;
  location_failures: number;
  has_demo: boolean;
}
