import { useEffect, useRef, type ReactNode } from "react";
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
  type WeatherPoint,
  type PublicReport,
  ODOR_DISPLAY,
} from "@/lib/types";
import { isCalm, sourceLabel, windDirName, windFromLabel, windToDeg } from "@/lib/weather";

/** Leaflet·카카오 두 지도 구현이 함께 쓰는 순수 로직 (묶음·색·정렬·선택 카드 내용) */

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
  /** 날씨(바람) 지점. 없거나 비어 있으면 그리지 않는다. 지도 맞춤에는 영향을 주지 않는다 */
  weather?: WeatherPoint[];
  /**
   * 대기·바람 아이콘 안내가 붙는 곳. "me"(기본)는 내 위치 점 위, "center"는 지도 왼쪽 위 카드(지도 가운데 기준).
   * 보여 줄 내용은 air·weather prop에서 만든다 (꺼져 있으면 해당 아이콘이 빠진다).
   */
  infoAnchor?: "me" | "center";
  /** 방금 접수한 제보 id. 그 제보가 든 칸 마커에 링과 "방금 내 제보" 라벨을 붙이고, 지도 중심을 그 칸에 둔다 */
  highlightId?: number;
}

/** 지도에서 고른 것 (마커·측정소 배지·바람 화살표). 설명은 지도 아래 카드에 나온다 */
export type MapSelection =
  | { kind: "reports"; group: MarkerGroup }
  | { kind: "air"; station: AirStation }
  | { kind: "wind"; point: WeatherPoint };

/** 구현(카카오·Leaflet)이 함께 받는 선택 관련 props */
export interface SelectProps {
  /** 마커 등을 누르면 부른다. null은 빈 곳 클릭(선택 해제) */
  onSelect?: (s: MapSelection | null) => void;
  /** 지금 선택된 항목의 키 (selectionKey). 해당 마커에 링을 그린다 */
  selectedKey?: string | null;
  /** 지도 컨테이너 바로 아래(같은 map-frame 안)에 그릴 것 */
  belowMap?: ReactNode;
}

export function selectionKey(s: MapSelection): string {
  if (s.kind === "reports") return groupKey(s.group);
  if (s.kind === "air") return `a:${s.station.site}`;
  return `w:${s.point.site}`;
}

export function groupKey(g: MarkerGroup) {
  return `r:${g.lat},${g.lng},${g.top.needs_review ? 1 : 0}`;
}

export const airKey = (st: AirStation) => `a:${st.site}`;
export const windKey = (w: WeatherPoint) => `w:${w.site}`;

/** 최신 reports·air·weather로 선택을 다시 찾는다. 사라졌으면 null (카드를 닫는다) */
export function refreshSelection(
  sel: MapSelection | null,
  reports: PublicReport[] | null | undefined,
  air: AirStation[] | undefined,
  weather: WeatherPoint[] | undefined,
): MapSelection | null {
  if (!sel) return null;
  if (sel.kind === "reports") {
    const key = groupKey(sel.group);
    const group = groupReports(reports ?? []).find((g) => groupKey(g) === key);
    return group ? { kind: "reports", group } : null;
  }
  if (sel.kind === "air") {
    const station = air?.find((a) => a.site === sel.station.site);
    return station ? { kind: "air", station } : null;
  }
  const point = weather?.find((w) => w.site === sel.point.site);
  return point ? { kind: "wind", point } : null;
}

export const SELECTED_CLASS = "odor-selected";

/** root 안에서 data-sel 키가 selectedKey인 요소에만 선택 링 클래스를 단다 */
export function applySelectedClass(root: ParentNode | null, selectedKey: string | null | undefined) {
  root?.querySelectorAll<HTMLElement>("[data-sel]").forEach((el) => {
    el.classList.toggle(SELECTED_CLASS, el.dataset.sel === selectedKey);
  });
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
  const parts = [`${formatTime(r.reported_at)}`, `강도 ${r.intensity} · ${INTENSITY_LABELS[r.intensity].short}`, ODOR_DISPLAY[r.odor_type] ?? r.odor_type];
  if (r.symptoms.length) parts.push(r.symptoms.join(", "));
  return parts.join(" · ");
}

function airValue(v: number | null, unit: string) {
  return v === null ? "-" : `${v}${unit}`;
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

/** 이 칸에 highlightId 제보가 들어 있는가 (병합된 제보도 같은 id) */
export function hasHighlight(g: MarkerGroup, highlightId: number | undefined) {
  return highlightId !== undefined && g.reports.some((r) => r.id === highlightId);
}

/** highlightId 제보가 든 칸 (없으면 null) */
export function findHighlightGroup(groups: MarkerGroup[], highlightId: number | undefined) {
  return groups.find((g) => hasHighlight(g, highlightId)) ?? null;
}

export const HIGHLIGHT_LABEL = "방금 내 제보";

/** 제보 마커 HTML (.odor-marker). 강조 칸만 바깥 링(.odor-mine)과 라벨이 붙는다 */
export function markerHtml(g: MarkerGroup, highlightId?: number) {
  const { top, count, size } = g;
  const fg = top.needs_review ? "#1F2A2E" : INTENSITY_TEXT[top.intensity];
  const mine = hasHighlight(g, highlightId);
  return (
    `<div class="odor-marker${mine ? " odor-mine" : ""}" data-sel="${groupKey(g)}" style="width:${size}px;height:${size}px;background:${colorOf(top)};color:${fg}">` +
    `${top.intensity}${count > 1 ? `<span class="odor-count">${count}</span>` : ""}` +
    `${mine ? `<span class="odor-mine-label">${HIGHLIGHT_LABEL}</span>` : ""}</div>`
  );
}

/** [저도 악취를 느꼈어요] 버튼을 보일 조건을 지금 값으로 확인한다 (맞지 않으면 null) */
export function meTooOffer(top: PublicReport, cfg: MeToo | undefined) {
  if (!cfg || cfg.disabled || !cfg.origin || top.needs_review) return null;
  if (distanceMeters(cfg.origin, { lat: top.grid_lat, lng: top.grid_lng }) > RULES.nearbyMeters) return null;
  const n = Number(top.intensity);
  return { id: Number(top.id), intensity: n, label: INTENSITY_LABELS[n]?.short ?? "" };
}

export interface ReportCardData {
  title: string;
  needsReview: boolean;
  lines: { id: number; text: string; photoIds: number[] }[];
  meToo: { id: number; intensity: number; label: string } | null;
}

/** 제보 묶음 카드 내용 (화면에서 React로 그린다) */
export function reportCardData(g: MarkerGroup, cfg: MeToo | undefined): ReportCardData {
  const lines = [...g.reports]
    .sort((a, b) => a.reported_at.localeCompare(b.reported_at))
    .map((r) => ({
      id: r.id,
      text: describe(r) + (r.merged_count > 1 ? ` (${r.merged_count}번 제보)` : ""),
      photoIds: r.photo_ids,
    }));
  return {
    title: `이 근처 제보 ${g.count}건 · 최고 강도 ${g.top.intensity}`,
    needsReview: g.top.needs_review,
    lines,
    meToo: meTooOffer(g.top, cfg),
  };
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
    html: `<div class="air-badge" data-sel="${airKey(st)}" style="background:${color}">${escapeHtml(label)}</div>`,
  };
}

export interface AirCardData {
  title: string;
  measured: string;
  grade: string;
  gradeColor: string;
  rows: { name: string; value: string }[];
  source: string;
}

/** 측정소 카드 내용 */
export function airCardData(st: AirStation): AirCardData {
  return {
    title: `${st.name} 측정소${st.approx ? " (대략 위치)" : ""}`,
    measured: `${Number(st.measured_at.slice(11, 13))}시 측정`,
    grade: st.cai ? AIR_CAI_LABELS[st.cai] : AIR_UNKNOWN_LABEL,
    gradeColor: st.cai ? AIR_CAI_COLORS[st.cai] : AIR_UNKNOWN_COLOR,
    rows: [
      { name: "PM10", value: airValue(st.pm10, "㎍/㎥") },
      { name: "PM2.5", value: airValue(st.pm25, "㎍/㎥") },
      { name: "오존", value: airValue(st.o3, "ppm") },
    ],
    source: "출처: 제주특별자치도 보건환경연구원",
  };
}

/**
 * 바람 상태 판정 (배지·말풍선 공용). 바람 정보가 없으면 '무풍'과 구분한다 (Codex 리뷰).
 * 무풍은 풍속을 알고 0.5m/s 미만일 때만.
 */
export function windState(w: Pick<WeatherPoint, "wind_speed" | "wind_dir">) {
  const missing = w.wind_speed === null || (w.wind_dir === null && !isCalm(w.wind_speed));
  const calm = !missing && isCalm(w.wind_speed);
  return { missing, calm };
}

/** 바람 화살표 오버레이 (원형 반투명 배경 + 화살표 + 풍속). 측정소 배지와 겹치지 않게 오른쪽 위로 비켜 놓는다 */
export function weatherBadge(w: WeatherPoint) {
  const { missing, calm } = windState(w);
  const speed = w.wind_speed === null ? "-" : `${w.wind_speed.toFixed(1)}m/s`;
  const dot = (fill: string) =>
    `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="${fill}"/></svg>`;
  const arrow = missing
    ? dot("#94A3B8")
    : calm
      ? dot("#0F766E")
      : `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" style="transform:rotate(${Math.round(windToDeg(w.wind_dir!))}deg)">` +
        `<path d="M12 2 L19 21 L12 16.5 L5 21 Z" fill="#0F766E" stroke="#fff" stroke-width="1" stroke-linejoin="round"/></svg>`;
  const title = missing
    ? `${w.name} 바람 정보 없음`
    : calm
      ? `${w.name} 바람 거의 없음`
      : `${w.name} ${windFromLabel(w.wind_dir!)} ${speed}`;
  return {
    width: 52,
    height: 60,
    title,
    html:
      `<div class="wind-badge" data-sel="${windKey(w)}"><div class="wind-disc">${arrow}</div>` +
      `<div class="wind-speed">${missing ? "정보 없음" : calm ? "무풍" : escapeHtml(speed)}</div></div>`,
  };
}

export interface WindCardData {
  title: string;
  lines: string[];
  source: string;
}

/** 날씨(바람) 카드 내용 */
export function windCardData(w: WeatherPoint): WindCardData {
  const { missing, calm } = windState(w);
  const speed = w.wind_speed === null ? "-" : `${w.wind_speed.toFixed(1)}m/s`;
  const lines: string[] = [];
  if (missing) {
    lines.push("지금은 바람 정보를 받지 못했어요");
  } else if (calm) {
    lines.push("바람이 거의 없어 냄새가 머물 수 있어요");
  } else {
    lines.push(`${windFromLabel(w.wind_dir!)} ${speed} — 냄새는 ${windDirName(windToDeg(w.wind_dir!))}쪽으로 퍼질 수 있어요`);
  }
  if (w.temp !== null) lines.push(`기온 ${w.temp.toFixed(1)}℃`);
  if (w.humidity !== null) lines.push(`습도 ${Math.round(w.humidity)}%`);
  lines.push(`하늘 상태: ${w.sky}`);
  if (w.rain_1h !== null && w.rain_1h > 0) lines.push(`1시간 강수 ${w.rain_1h}mm`);
  return {
    title: `${w.name} 날씨`,
    lines,
    source: `${sourceLabel(w.source)} · ${w.at.slice(11, 16)} 기준`,
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

/** 카드 버튼이 항상 최신 값을 읽도록 ref에 둔다 */
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
 * 요소가 지도 영역(여백 margin 안쪽)을 넘치는 만큼, 지도 중심을 옮길 픽셀 {dx, dy}.
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

export const Z_REPORT_BASE = 10;
const Z_TIER = 450; // 한 등급(확인 필요 / 정상)이 쓰는 z 범위. 선택 카드·안내(950 이상)보다 항상 낮다

/**
 * 제보 마커 z-index. groupIndex는 groupReports가 돌려준 순서(확인 필요 먼저, 약한 순)의 자리.
 * 확인 필요 묶음은 항상 정상 묶음보다 아래, 각 등급 안에서는 순서대로 위에 쌓인다.
 */
export function markerZ(groupIndex: number, needsReview: boolean) {
  const i = Math.min(Math.max(groupIndex, 0), Z_TIER - 1);
  return Z_REPORT_BASE + (needsReview ? 0 : Z_TIER) + i;
}


// ---- 대기·바람 아이콘 안내 (내 위치 위 / 지도 가운데 카드) ----

/** origin에서 가장 가까운 항목 (없으면 null) */
export function nearestPoint<T extends { lat: number; lng: number }>(
  origin: { lat: number; lng: number },
  items: T[] | undefined,
): T | null {
  if (!items?.length) return null;
  return items.reduce((best, p) => (distanceMeters(origin, p) < distanceMeters(origin, best) ? p : best));
}

const AIR_EMOJI: Record<number, string> = { 1: "😀", 2: "🙂", 3: "😷", 4: "🤢" };
/** 대기 등급 -> 표정 이모지 (모르면 ❔) */
export function airEmoji(cai: AirStation["cai"]) {
  return cai ? AIR_EMOJI[cai] : "❔";
}

export interface InfoContent {
  anchorLabel: string;
  air: { label: string; color: string; emoji: string } | null;
  wind: { kind: "missing" | "calm" | "wind"; toDeg: number; speed: string; text: string } | null;
  /** 설명 첫 줄: "내 위치 · 대기 보통" */
  head: string;
  /** 작은 회색 줄: "애월 측정소 기준 · 기상청 09:00" */
  footer: string;
  /** 버튼 aria-label 전체 문장 */
  aria: string;
}

/** 출처·시각 문구: 대기가 있으면 "애월 측정소 기준", 없으면 "애월 기준", 날씨가 있으면 "· 기상청 09:00" */
export function infoFooter(st: AirStation | null, w: WeatherPoint | null) {
  const parts: string[] = [];
  if (st) parts.push(`${st.name} 측정소 기준`);
  else if (w) parts.push(`${w.name} 기준`);
  if (w) parts.push(`${w.source} ${w.at.slice(11, 16)}`);
  return parts.join(" · ");
}

/**
 * 말풍선·카드 내용. origin에서 가장 가까운 측정소(air)·날씨 지점(weather)을 각각 고른다.
 * air/weather가 없거나 비면 해당 부분을 뺀다. 둘 다 없으면 null (보여 주지 않는다).
 */
export function buildInfoContent(
  anchorLabel: string,
  origin: { lat: number; lng: number },
  air: AirStation[] | undefined,
  weather: WeatherPoint[] | undefined,
): InfoContent | null {
  const st = nearestPoint(origin, air);
  const w = nearestPoint(origin, weather);
  if (!st && !w) return null;
  const airInfo = st
    ? {
        label: st.cai ? AIR_CAI_LABELS[st.cai] : AIR_UNKNOWN_LABEL,
        color: st.cai ? AIR_CAI_COLORS[st.cai] : AIR_UNKNOWN_COLOR,
        emoji: airEmoji(st.cai),
      }
    : null;
  let wind: InfoContent["wind"] = null;
  let windSentence = "";
  if (w) {
    const { missing, calm } = windState(w);
    if (missing) {
      wind = { kind: "missing", toDeg: 0, speed: "-", text: "바람 정보 없음" };
      windSentence = "바람 정보 없음";
    } else if (calm) {
      wind = { kind: "calm", toDeg: 0, speed: "무풍", text: "바람 거의 없음 · 냄새가 머물 수 있어요" };
      windSentence = "바람 거의 없음, 냄새가 머물 수 있어요";
    } else {
      const speed = `${w.wind_speed!.toFixed(1)}m/s`;
      const toDeg = windToDeg(w.wind_dir!);
      wind = { kind: "wind", toDeg, speed, text: `${windFromLabel(w.wind_dir!)} ${speed} · 냄새는 ${windDirName(toDeg)}쪽으로` };
      windSentence = `${windFromLabel(w.wind_dir!)} ${w.wind_speed!.toFixed(1)}미터, 냄새는 ${windDirName(toDeg)}쪽으로 퍼질 수 있어요`;
    }
  }
  const footer = infoFooter(st, w);
  const head = airInfo ? `${anchorLabel} · 대기 ${airInfo.label}` : anchorLabel;
  const aria = [airInfo ? `${anchorLabel} 대기 ${airInfo.label}` : anchorLabel, windSentence, footer].filter(Boolean).join(", ");
  return { anchorLabel, air: airInfo, wind, head, footer, aria };
}

/**
 * 아이콘 버튼 HTML (.info-bubble). collapsed면 아이콘만, 아니면 위에 설명이 펼쳐진다.
 * 이모지·SVG는 aria-hidden, 버튼의 aria-label이 전체 문장을 읽어 준다.
 */
export function infoBubbleHtml(c: InfoContent, collapsed: boolean, withTag = false) {
  const airIcon = c.air
    ? `<span class="info-ic"><span class="info-air" style="background:${c.air.color}" aria-hidden="true">${c.air.emoji}</span></span>`
    : "";
  let windIcon = "";
  if (c.wind) {
    const fill = c.wind.kind === "missing" ? "#94A3B8" : "#0F766E";
    const inner =
      c.wind.kind === "wind"
        ? `<svg viewBox="0 0 24 24" width="26" height="26" style="transform:rotate(${Math.round(c.wind.toDeg)}deg)"><path d="M12 2 L19 21 L12 16.5 L5 21 Z" fill="#fff" stroke="#fff" stroke-width="1" stroke-linejoin="round"/></svg>`
        : `<svg viewBox="0 0 24 24" width="26" height="26"><circle cx="12" cy="12" r="4" fill="#fff"/></svg>`;
    windIcon =
      `<span class="info-ic"><span class="info-wind-ic" style="background:${fill}" aria-hidden="true">${inner}</span>` +
      `<span class="info-wind-num" aria-hidden="true">${escapeHtml(c.wind.speed)}</span></span>`;
  }
  const detail =
    `<span class="info-detail" aria-hidden="true"><strong>${escapeHtml(c.head)}</strong>` +
    (c.wind ? `<span>${escapeHtml(c.wind.text)}</span>` : "") +
    (c.footer ? `<span class="info-foot">${escapeHtml(c.footer)}</span>` : "") +
    `</span>`;
  return (
    `<button type="button" class="info-bubble" data-collapsed="${collapsed}" aria-expanded="${!collapsed}" aria-label="${escapeHtml(c.aria)}">` +
    detail +
    `<span class="info-icons">${withTag ? `<span class="info-tag" aria-hidden="true">${escapeHtml(c.anchorLabel)}</span>` : ""}${airIcon}${windIcon}</span>` +
    `</button>`
  );
}

/** 버튼 접기/펼치기. 새 접힘 상태를 돌려준다 */
export function toggleInfoButton(btn: HTMLElement): boolean {
  const collapsed = btn.dataset.collapsed !== "true";
  btn.dataset.collapsed = String(collapsed);
  btn.setAttribute("aria-expanded", String(!collapsed));
  return collapsed;
}

/** root 안의 .info-bubble 버튼에 클릭 토글을 단다 (지도 클릭으로 번지지 않게 막는다) */
export function bindInfoToggle(root: HTMLElement, onToggle: (collapsed: boolean) => void) {
  const btn = root.querySelector<HTMLElement>(".info-bubble");
  btn?.addEventListener("click", (e) => {
    e.stopPropagation();
    onToggle(toggleInfoButton(btn));
  });
  return btn;
}
