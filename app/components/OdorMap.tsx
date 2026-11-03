"use client";

import { useEffect, useRef, useState } from "react";
import type { LayerGroup, Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import { distanceMeters, RULES } from "@/lib/rules";
import { formatTime } from "@/lib/time";
import {
  AIR_CAI_COLORS,
  AIR_CAI_LABELS,
  AIR_UNKNOWN_COLOR,
  AIR_UNKNOWN_LABEL,
  INTENSITY_COLORS,
  INTENSITY_LABELS,
  REVIEW_COLOR,
  type AirStation,
  type PublicReport,
} from "@/lib/types";

const AEWOL_CENTER: [number, number] = [33.44, 126.33];
const ME_ZOOM = 14;

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

export const photoSrc = (id: number) => `/api/photos/${id}`;

export function colorOf(r: PublicReport) {
  return r.needs_review ? REVIEW_COLOR : INTENSITY_COLORS[r.intensity];
}

function maxIntensity(group: PublicReport[]) {
  return Math.max(...group.map((r) => r.intensity));
}

function describe(r: PublicReport) {
  const parts = [`${formatTime(r.reported_at)}`, `강도 ${r.intensity} ${INTENSITY_LABELS[r.intensity].short}`, r.odor_type];
  if (r.symptoms.length) parts.push(r.symptoms.join(", "));
  return parts.join(" · ");
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function airValue(v: number | null, unit: string) {
  return v === null ? "-" : `${v}${unit}`;
}

function airPopup(st: AirStation, label: string) {
  const hour = Number(st.measured_at.slice(11, 13));
  return (
    `<strong>${escapeHtml(st.name)} 측정소${st.approx ? " (대략 위치)" : ""}</strong><br>` +
    `${hour}시 측정<br>` +
    `통합대기 등급: ${escapeHtml(label)}<br>` +
    `PM10 ${airValue(st.pm10, "㎍/㎥")}<br>` +
    `PM2.5 ${airValue(st.pm25, "㎍/㎥")}<br>` +
    `오존 ${airValue(st.o3, "ppm")}<br>` +
    `<span class="muted small">출처: 제주특별자치도 보건환경연구원</span>`
  );
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

/**
 * 오늘 제보 지도 (/map과 /report가 함께 쓴다).
 * - 같은 격자 칸의 제보는 마커 하나로 묶고, 강도 색·확인 필요 회색으로 그린다.
 * - me가 있으면 내 위치(파란 점·정확도 원)를 보여 주고 그 위치를 중심으로 맞춘다. 없으면 제보가 모인 곳에 맞춘다.
 * - active가 false에서 true로 바뀌면(숨겨 둔 탭이 다시 보일 때) 지도 크기를 다시 계산한다.
 * - 타일이 하나도 안 뜨면 onTileFailed를 부른다.
 */
export default function OdorMap({
  reports,
  me = null,
  active = true,
  className = "map",
  onTileFailed,
  meToo,
  air,
}: {
  reports: PublicReport[] | null;
  me?: MyPosition | null;
  active?: boolean;
  className?: string;
  onTileFailed?: () => void;
  meToo?: MeToo;
  /** 대기질 측정소. 없거나 비어 있으면 그리지 않는다. 지도 맞춤(fitBounds)에는 영향을 주지 않는다 */
  air?: AirStation[];
}) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const meLayerRef = useRef<LayerGroup | null>(null);
  const airLayerRef = useRef<LayerGroup | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const [ready, setReady] = useState(0);
  const tileFailedRef = useRef(onTileFailed);
  useEffect(() => {
    tileFailedRef.current = onTileFailed;
  }, [onTileFailed]);

  // 팝업 버튼이 항상 최신 값을 읽도록 ref에 둔다
  const meTooRef = useRef(meToo);
  const reportsRef = useRef(reports);
  useEffect(() => {
    meTooRef.current = meToo;
    reportsRef.current = reports;
  });
  // 제출이 시작되면 열려 있는 팝업(버튼)을 닫는다
  const meTooDisabled = !!meToo?.disabled;
  useEffect(() => {
    if (meTooDisabled) mapRef.current?.closePopup();
  }, [meTooDisabled]);

  // 지도 만들기 (브라우저에서만)
  useEffect(() => {
    let disposed = false;
    import("leaflet").then((L) => {
      if (disposed || !mapEl.current || mapRef.current) return;
      leafletRef.current = L;
      const map = L.map(mapEl.current, { zoomControl: true }).setView(AEWOL_CENTER, 13);
      let anyTileLoaded = false;
      const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      });
      tiles.on("tileload", () => {
        anyTileLoaded = true;
      });
      tiles.on("tileerror", () => {
        if (!anyTileLoaded) tileFailedRef.current?.();
      });
      tiles.addTo(map);
      // 팝업이 열릴 때마다 새로 만들어진 버튼에 직접 클릭 리스너를 붙인다
      // (팝업은 클릭 전파를 막아서 지도 컨테이너 위임은 쓸 수 없다. 팝업을 닫으면 요소째 버려진다)
      const onMeTooClick = (ev: Event) => {
        const id = Number((ev.currentTarget as HTMLElement).dataset.meToo);
        const cfg = meTooRef.current;
        if (!cfg || cfg.disabled || !cfg.origin) return;
        const r = reportsRef.current?.find((x) => x.id === id);
        if (!r || r.needs_review) return;
        map.closePopup();
        cfg.onPick(r);
      };
      map.on("popupopen", (e) => {
        e.popup
          .getElement()
          ?.querySelectorAll<HTMLButtonElement>("button[data-me-too]")
          .forEach((b) => b.addEventListener("click", onMeTooClick));
      });
      // 측정소는 제보 마커(markerPane 600)보다 아래 층에 그린다
      map.createPane("air").style.zIndex = "550";
      airLayerRef.current = L.layerGroup().addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      meLayerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setReady((n) => n + 1);
    });
    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // 마커 그리기
  useEffect(() => {
    const L = leafletRef.current;
    const layer = layerRef.current;
    if (!L || !layer || !reports) return;
    layer.clearLayers();
    // 같은 격자 칸의 제보는 마커 하나로 묶는다 (가장 높은 강도 표시, 확인 필요는 따로)
    const cells = new Map<string, PublicReport[]>();
    for (const r of reports) {
      const key = `${r.grid_lat},${r.grid_lng},${r.needs_review}`;
      cells.set(key, [...(cells.get(key) ?? []), r]);
    }
    // 강한 칸이 위에 보이도록 약한 칸부터 그린다
    const groups = [...cells.values()].sort(
      (a, b) => Number(!a[0].needs_review) - Number(!b[0].needs_review) || maxIntensity(a) - maxIntensity(b),
    );
    // 팝업을 열 때마다 최신 위치·상태로 조건을 다시 계산한다 (조건이 안 맞으면 버튼 자체가 없다)
    const meTooHtml = (top: PublicReport) => {
      const cfg = meTooRef.current;
      if (!cfg || cfg.disabled || !cfg.origin || top.needs_review) return "";
      if (distanceMeters(cfg.origin, { lat: top.grid_lat, lng: top.grid_lng }) > RULES.nearbyMeters) return "";
      const n = Number(top.intensity);
      return (
        `<div class="me-too">` +
        `<button type="button" class="me-too-btn" data-me-too="${Number(top.id)}">저도 악취를 느꼈어요</button>` +
        `<div class="me-too-help">내 위치에서 같은 세기(강도 ${n})로 제보돼요</div></div>`
      );
    };
    for (const group of groups) {
      const top = group.reduce((m, r) => (r.intensity > m.intensity ? r : m));
      const count = group.length;
      const size = 28 + top.intensity * 3 + Math.min(count - 1, 6) * 2;
      const strong = !top.needs_review && top.intensity >= 4;
      const icon = L.divIcon({
        className: "",
        html:
          `<div class="odor-marker${strong ? " strong" : ""}" style="width:${size}px;height:${size}px;background:${colorOf(top)}">` +
          `${top.intensity}${count > 1 ? `<span class="odor-count">${count}</span>` : ""}</div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
      const label = `최고 강도 ${top.intensity}, 제보 ${count}건${top.needs_review ? " (확인 필요)" : ""}`;
      const lines = [...group]
        .sort((a, b) => a.reported_at.localeCompare(b.reported_at))
        .map(
          (r) =>
            escapeHtml(describe(r)) +
            (r.merged_count > 1 ? ` (${r.merged_count}번 제보)` : "") +
            popupPhotos(r),
        );
      L.marker([top.grid_lat, top.grid_lng], { icon, title: label, alt: label, keyboard: true })
        .bindPopup(() =>
          `<strong>이 근처 제보 ${count}건 · 최고 강도 ${top.intensity}</strong>` +
            (top.needs_review ? "<br><em>확인 필요 (요약에서 제외)</em>" : "") +
            `<br>${lines.join("<br>")}` +
            meTooHtml(top),
        )
        .addTo(layer);
    }
  }, [reports, ready]);

  // 대기질 측정소 (둥근 사각형 배지 + 등급 글자)
  useEffect(() => {
    const L = leafletRef.current;
    const layer = airLayerRef.current;
    if (!L || !layer) return;
    layer.clearLayers();
    for (const st of air ?? []) {
      const label = st.cai ? AIR_CAI_LABELS[st.cai] : AIR_UNKNOWN_LABEL;
      const color = st.cai ? AIR_CAI_COLORS[st.cai] : AIR_UNKNOWN_COLOR;
      const w = label.length > 4 ? 78 : 62;
      const icon = L.divIcon({
        className: "",
        html: `<div class="air-badge" style="background:${color}">${escapeHtml(label)}</div>`,
        iconSize: [w, 26],
        iconAnchor: [w / 2, 13],
      });
      const title = `${st.name} 측정소 ${label}`;
      L.marker([st.lat, st.lng], { icon, pane: "air", title, alt: title, keyboard: true })
        .bindPopup(() => airPopup(st, label))
        .addTo(layer);
    }
  }, [air, ready]);

  // 내 위치 표시
  useEffect(() => {
    const L = leafletRef.current;
    const layer = meLayerRef.current;
    if (!L || !layer) return;
    layer.clearLayers();
    if (!me) return;
    const at: [number, number] = [me.lat, me.lng];
    if (me.accuracy > 0) {
      L.circle(at, { radius: Math.min(me.accuracy, 500), color: "#2563eb", weight: 1, fillOpacity: 0.12, interactive: false }).addTo(layer);
    }
    L.circleMarker(at, { radius: 9, color: "#fff", weight: 3, fillColor: "#2563eb", fillOpacity: 1, interactive: false }).addTo(layer);
  }, [me, ready]);

  // 보이는 범위: 내 위치가 있으면 그 중심, 없으면 강도 4 이상이 모인 곳 (없으면 전체 제보)
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    if (me) {
      map.setView([me.lat, me.lng], ME_ZOOM);
      return;
    }
    if (!reports) return;
    const valid = reports.filter((r) => !r.needs_review);
    const strongOnes = valid.filter((r) => r.intensity >= 4);
    const focus = strongOnes.length ? strongOnes : valid;
    if (focus.length) {
      map.fitBounds(L.latLngBounds(focus.map((r) => [r.grid_lat, r.grid_lng] as [number, number])), {
        padding: [40, 40],
        maxZoom: 15,
      });
    }
  }, [reports, me, ready]);

  // 숨겨 둔 탭이 다시 보이면 크기 다시 계산
  useEffect(() => {
    if (active) setTimeout(() => mapRef.current?.invalidateSize(), 0);
  }, [active]);

  return <div ref={mapEl} className={className} role="region" aria-label="악취 제보 지도" />;
}

export function Legend({ withMe = false, withAir = false }: { withMe?: boolean; withAir?: boolean }) {
  const items = [
    { n: "1-2", color: INTENSITY_COLORS[1], text: "살짝·보통" },
    { n: "3", color: INTENSITY_COLORS[3], text: "강함" },
    { n: "4-5", color: INTENSITY_COLORS[4], text: "극심·참기 어려움", strong: true },
  ];
  return (
    <div className="legend" aria-label="범례">
      {items.map((i) => (
        <span key={i.n}>
          <span className="dot" style={{ background: i.color, color: i.strong ? "#fff" : undefined, width: 34, borderRadius: 13 }}>
            {i.n}
          </span>
          {i.text}
        </span>
      ))}
      <span>
        <span className="dot" style={{ background: REVIEW_COLOR }}>?</span>
        확인 필요
      </span>
      {withMe ? (
        <span>
          <span className="dot" style={{ background: "#2563eb", border: "3px solid #fff", boxShadow: "0 0 0 1px #2563eb" }} />
          내 위치
        </span>
      ) : null}
      {withAir ? (
        <span>
          <span className="air-swatch" aria-hidden="true" />
          대기질 측정소
        </span>
      ) : null}
    </div>
  );
}
