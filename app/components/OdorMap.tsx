"use client";

import { useEffect, useRef, useState } from "react";
import type { LayerGroup, Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import { formatTime } from "@/lib/time";
import { INTENSITY_COLORS, INTENSITY_LABELS, REVIEW_COLOR, type PublicReport } from "@/lib/types";

const AEWOL_CENTER: [number, number] = [33.44, 126.33];
const ME_ZOOM = 14;

export interface MyPosition {
  lat: number;
  lng: number;
  accuracy: number;
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
}: {
  reports: PublicReport[] | null;
  me?: MyPosition | null;
  active?: boolean;
  className?: string;
  onTileFailed?: () => void;
}) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const meLayerRef = useRef<LayerGroup | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const [ready, setReady] = useState(0);
  const tileFailedRef = useRef(onTileFailed);
  useEffect(() => {
    tileFailedRef.current = onTileFailed;
  }, [onTileFailed]);

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
        .bindPopup(
          `<strong>이 근처 제보 ${count}건 · 최고 강도 ${top.intensity}</strong>` +
            (top.needs_review ? "<br><em>확인 필요 (요약에서 제외)</em>" : "") +
            `<br>${lines.join("<br>")}`,
        )
        .addTo(layer);
    }
  }, [reports, ready]);

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

export function Legend({ withMe = false }: { withMe?: boolean }) {
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
    </div>
  );
}
