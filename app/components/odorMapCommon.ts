import { useEffect, useRef } from "react";
import { distanceMeters, RULES } from "@/lib/rules";
import { formatTime } from "@/lib/time";
import {
  AIR_CAI_COLORS,
  AIR_CAI_LABELS,
  AIR_UNKNOWN_COLOR,
  AIR_UNKNOWN_LABEL,
  INTENSITY_COLORS,
  INTENSITY_LABELS,
  INTENSITY_TEXT,
  REVIEW_COLOR,
  type AirStation,
  type PublicReport,
} from "@/lib/types";

/** Leaflet·카카오 두 지도 구현이 함께 쓰는 순수 로직 (묶음·색·정렬·팝업 문구) */

export const AEWOL_CENTER = { lat: 33.44, lng: 126.33 };

export interface MyPosition {
  lat: number;
  lng: number;
  accuracy: number;
}

/** [저도 악취를 느꼈어요] 설정. 없으면 버튼을 만들지 않는다 (/map). */
export interface MeToo {
  origin: { lat: number; lng: number } | null;
  onPick: (r: PublicReport) => void;
  disabled?: boolean;
}

/** OdorMap 공개 props (Leaflet·카카오 구현이 같은 모양을 받는다) */
export interface OdorMapProps {
  reports: PublicReport[] | null;
  me?: MyPosition | null;
  active?: boolean;
  className?: string;
  meToo?: MeToo;
  /** 대기질 측정소. 없거나 비어 있으면 그리지 않는다. 지도 맞춤에는 영향을 주지 않는다 */
  air?: AirStation[];
}

export const photoSrc = (id: number) => `/api/photos/${id}`;

export function colorOf(r: PublicReport) {
  return r.needs_review ? REVIEW_COLOR : INTENSITY_COLORS[r.intensity];
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function maxIntensity(group: PublicReport[]) {
  return Math.max(...group.map((r) => r.intensity));
}

function describe(r: PublicReport) {
  const parts = [`${formatTime(r.reported_at)}`, `강도 ${r.intensity} · ${INTENSITY_LABELS[r.intensity].short}`, r.odor_type];
  if (r.symptoms.length) parts.push(r.symptoms.join(", "));
  return parts.join(" · ");
}

function airValue(v: number | null, unit: string) {
  return v === null ? "-" : `${v}${unit}`;
}

/** 팝업 안 사진 (숫자 id만 넣으므로 그대로 HTML에 써도 안전) */
function popupPhotos(r: PublicReport) {
  if (!r.photo_ids.length) return "";
  const imgs = r.photo_ids
    .map(
      (id) =>
        `<a href="${photoSrc(id)}" target="_blank" rel="noopener"><img src="${photoSrc(id)}" alt="제보 사진" loading="lazy"></a>`,
    )
    .join("");
  return `<div class="popup-photos">${imgs}</div>`;
}

/** 마커 한 개가 되는 제보 묶음 */
export interface MarkerGroup {
  top: PublicReport;
  reports: PublicReport[];
  count: number;
  /** 마커 지름(px) */
  size: number;
  lat: number;
  lng: number;
  label: string;
}

/**
 * 같은 격자 칸의 제보는 하나로 묶는다 (가장 높은 강도 표시, 확인 필요는 따로).
 * 강한 칸이 위에 보이도록 약한 칸부터 정렬해 돌려준다 (확인 필요 → 약한 순 → 강한 순).
 */
export function groupReports(reports: PublicReport[]): MarkerGroup[] {
  const cells = new Map<string, PublicReport[]>();
  for (const r of reports) {
    const key = `${r.grid_lat},${r.grid_lng},${r.needs_review}`;
    cells.set(key, [...(cells.get(key) ?? []), r]);
  }
  const groups = [...cells.values()].sort(
    (a, b) => Number(!a[0].needs_review) - Number(!b[0].needs_review) || maxIntensity(a) - maxIntensity(b),
  );
  return groups.map((group) => {
    const top = group.reduce((m, r) => (r.intensity > m.intensity ? r : m));
    const count = group.length;
    return {
      top,
      reports: group,
      count,
      size: 28 + top.intensity * 3 + Math.min(count - 1, 6) * 2,
      lat: top.grid_lat,
      lng: top.grid_lng,
      label: `최고 강도 ${top.intensity}, 제보 ${count}건${top.needs_review ? " (확인 필요)" : ""}`,
    };
  });
}

/** 제보 마커 HTML (.odor-marker) */
export function markerHtml(g: MarkerGroup) {
  const { top, count, size } = g;
  const fg = top.needs_review ? "#1F2A2E" : INTENSITY_TEXT[top.intensity];
  return (
    `<div class="odor-marker" style="width:${size}px;height:${size}px;background:${colorOf(top)};color:${fg}">` +
    `${top.intensity}${count > 1 ? `<span class="odor-count">${count}</span>` : ""}</div>`
  );
}

/** 팝업을 열 때마다 최신 위치·상태로 조건을 다시 계산한다 (조건이 안 맞으면 버튼 자체가 없다) */
function meTooHtml(top: PublicReport, cfg: MeToo | undefined) {
  if (!cfg || cfg.disabled || !cfg.origin || top.needs_review) return "";
  if (distanceMeters(cfg.origin, { lat: top.grid_lat, lng: top.grid_lng }) > RULES.nearbyMeters) return "";
  const n = Number(top.intensity);
  return (
    `<div class="me-too">` +
    `<button type="button" class="me-too-btn" data-me-too="${Number(top.id)}">저도 악취를 느꼈어요</button>` +
    `<div class="me-too-help">내 위치에서 같은 세기(${n} · ${INTENSITY_LABELS[n]?.short ?? ""})로 제보돼요</div></div>`
  );
}

/** 제보 묶음 팝업 HTML */
export function reportPopupHtml(g: MarkerGroup, cfg: MeToo | undefined) {
  const lines = [...g.reports]
    .sort((a, b) => a.reported_at.localeCompare(b.reported_at))
    .map(
      (r) =>
        escapeHtml(describe(r)) + (r.merged_count > 1 ? ` (${r.merged_count}번 제보)` : "") + popupPhotos(r),
    );
  return (
    `<strong>이 근처 제보 ${g.count}건 · 최고 강도 ${g.top.intensity}</strong>` +
    (g.top.needs_review ? "<br><em>확인 필요 (요약에서 제외)</em>" : "") +
    `<br>${lines.join("<br>")}` +
    meTooHtml(g.top, cfg)
  );
}

/** [저도 악취를 느꼈어요] 클릭 처리: 현재 조건을 다시 확인하고 맞으면 onPick을 부른다. 처리했으면 true */
export function pickMeToo(id: number, cfg: MeToo | undefined, reports: PublicReport[] | null | undefined) {
  if (!cfg || cfg.disabled || !cfg.origin) return false;
  const r = reports?.find((x) => x.id === id);
  if (!r || r.needs_review) return false;
  cfg.onPick(r);
  return true;
}

/** 대기 측정소 배지 (둥근 사각형 + 등급 글자) */
export function airBadge(st: AirStation) {
  const label = st.cai ? AIR_CAI_LABELS[st.cai] : AIR_UNKNOWN_LABEL;
  const color = st.cai ? AIR_CAI_COLORS[st.cai] : AIR_UNKNOWN_COLOR;
  const width = label.length > 4 ? 78 : 62;
  const title = `${st.name} 측정소 ${label}`;
  return {
    label,
    width,
    height: 26,
    title,
    html: `<div class="air-badge" style="background:${color}">${escapeHtml(label)}</div>`,
    popup:
      `<strong>${escapeHtml(st.name)} 측정소${st.approx ? " (대략 위치)" : ""}</strong><br>` +
      `${Number(st.measured_at.slice(11, 13))}시 측정<br>` +
      `통합대기 등급: ${escapeHtml(label)}<br>` +
      `PM10 ${airValue(st.pm10, "㎍/㎥")}<br>` +
      `PM2.5 ${airValue(st.pm25, "㎍/㎥")}<br>` +
      `오존 ${airValue(st.o3, "ppm")}<br>` +
      `<span class="muted small">출처: 제주특별자치도 보건환경연구원</span>`,
  };
}

/** 내 위치가 없을 때 맞출 점들: 강도 4 이상이 모인 곳 (없으면 확인 필요 아닌 전체 제보) */
export function focusPoints(reports: PublicReport[]) {
  const valid = reports.filter((r) => !r.needs_review);
  const strongOnes = valid.filter((r) => r.intensity >= 4);
  return (strongOnes.length ? strongOnes : valid).map((r) => ({ lat: r.grid_lat, lng: r.grid_lng }));
}

/** 정확도 원 반지름 (최대 500m, 정확도 정보가 없으면 0) */
export function accuracyRadius(me: MyPosition) {
  return me.accuracy > 0 ? Math.min(me.accuracy, 500) : 0;
}

/** 팝업 버튼이 항상 최신 값을 읽도록 ref에 둔다 */
export function useLatestRefs(reports: PublicReport[] | null, meToo: MeToo | undefined) {
  const meTooRef = useRef(meToo);
  const reportsRef = useRef(reports);
  useEffect(() => {
    meTooRef.current = meToo;
    reportsRef.current = reports;
  });
  return { meTooRef, reportsRef };
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * 팝업이 지도 영역(여백 margin 안쪽)을 넘치는 만큼, 지도 중심을 옮길 픽셀 {dx, dy}.
 * 카카오 map.panBy(dx, dy)에 그대로 넘긴다 (지도 중심이 +dx면 오른쪽, +dy면 아래로 간다).
 * 팝업이 지도보다 크면 왼쪽·위쪽 가장자리(닫기 버튼 쪽)가 보이도록 맞춘다.
 */
export function overflowPan(popup: Box, map: Box, margin: number): { dx: number; dy: number } {
  const axis = (pLo: number, pHi: number, mLo: number, mHi: number) => {
    const lo = mLo + margin;
    const hi = mHi - margin;
    if (pLo < lo) return pLo - lo; // 시작쪽이 넘침 -> 중심을 그쪽(음수)으로
    if (pHi > hi) return Math.min(pHi - hi, pLo - lo); // 끝쪽이 넘침 (시작쪽이 가려지지 않는 범위까지만)
    return 0;
  };
  return {
    dx: axis(popup.left, popup.right, map.left, map.right),
    dy: axis(popup.top, popup.bottom, map.top, map.bottom),
  };
}

/** 말풍선 최대 크기: 지도 안에 (여백 포함) 들어가고, 높이는 화면의 45%도 넘지 않는다. gap은 마커와의 간격 */
export function popupMaxSize(mapWidth: number, mapHeight: number, gap: number, margin: number, viewportHeight: number) {
  return {
    maxWidth: Math.max(120, mapWidth - margin * 2),
    maxHeight: Math.max(80, Math.min(viewportHeight * 0.45, mapHeight - margin * 2 - gap)),
  };
}

export const Z_REPORT_BASE = 10;
const Z_TIER = 450; // 한 등급(확인 필요 / 정상)이 쓰는 z 범위. 팝업(1000)보다 항상 낮다

/**
 * 제보 마커 z-index. groupIndex는 groupReports가 돌려준 순서(확인 필요 먼저, 약한 순)의 자리.
 * 확인 필요 묶음은 항상 정상 묶음보다 아래, 각 등급 안에서는 순서대로 위에 쌓인다.
 */
export function markerZ(groupIndex: number, needsReview: boolean) {
  const i = Math.min(Math.max(groupIndex, 0), Z_TIER - 1);
  return Z_REPORT_BASE + (needsReview ? 0 : Z_TIER) + i;
}
