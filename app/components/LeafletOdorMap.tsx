"use client";

import { useEffect, useRef, useState } from "react";
import type { LayerGroup, Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  AEWOL_CENTER,
  accuracyRadius,
  airBadge,
  bindInfoToggle,
  buildInfoContent,
  infoBubbleHtml,
  overflowPan,
  applySelectedClass,
  findHighlightGroup,
  focusPoints,
  groupReports,
  hasHighlight,
  markerHtml,
  weatherBadge,
  type OdorMapProps,
  type SelectProps,
} from "./odorMapCommon";
import { CenterInfoCard } from "./MapInfo";

const ME_ZOOM = 14;

/** Leaflet + OpenStreetMap 구현 (카카오맵을 못 쓸 때의 대체) */
export default function LeafletOdorMap({
  reports,
  me = null,
  active = true,
  className = "map",
  air,
  weather,
  infoAnchor = "me",
  highlightId,
  onSelect,
  selectedKey,
  belowMap,
  onTileFailed,
}: OdorMapProps & SelectProps & { onTileFailed?: () => void }) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const meLayerRef = useRef<LayerGroup | null>(null);
  const airLayerRef = useRef<LayerGroup | null>(null);
  const weatherLayerRef = useRef<LayerGroup | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const [ready, setReady] = useState(0);
  const [center, setCenterState] = useState<{ lat: number; lng: number } | null>(null);
  const infoLayerRef = useRef<LayerGroup | null>(null);
  const infoCollapsedRef = useRef(true);
  const infoPannedRef = useRef(false);
  const tileFailedRef = useRef(onTileFailed);
  useEffect(() => {
    tileFailedRef.current = onTileFailed;
  }, [onTileFailed]);

  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  });
  // 부모가 다시 그려질 때마다 내용이 같은 새 배열·객체가 올 수 있다. 내용이 바뀐 경우에만 다시 그리고 지도를 맞춘다
  const reportsKey = reports
    ? reports.map((r) => `${r.id}:${r.intensity}:${r.merged_count}:${r.needs_review ? 1 : 0}:${r.photo_ids.length}`).join("|")
    : "loading"; // 불러오는 중(null)과 빈 날짜([])를 구분해야 날짜를 바꿀 때 옛 마커가 지워진다
  const meKey = me ? `${me.lat.toFixed(5)},${me.lng.toFixed(5)}` : "";
  // 지도 만들기 (브라우저에서만)
  useEffect(() => {
    let disposed = false;
    import("leaflet").then((L) => {
      if (disposed || !mapEl.current || mapRef.current) return;
      leafletRef.current = L;
      const map = L.map(mapEl.current, { zoomControl: false }).setView([AEWOL_CENTER.lat, AEWOL_CENTER.lng], 13);
      // 줌 컨트롤은 오른쪽 위 (왼쪽 위는 지도 가운데 카드 자리)
      L.control.zoom({ position: "topright" }).addTo(map);
      const syncCenter = () => {
        const c = map.getCenter();
        setCenterState({ lat: c.lat, lng: c.lng });
      };
      map.on("moveend", syncCenter);
      syncCenter();
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
      // 빈 곳을 누르면 선택 해제 (마커 클릭은 지도 클릭으로 번지지 않는다)
      map.on("click", () => onSelectRef.current?.(null));
      // 측정소는 제보 마커(markerPane 600)보다 아래 층에 그린다
      map.createPane("air").style.zIndex = "550";
      airLayerRef.current = L.layerGroup().addTo(map);
      weatherLayerRef.current = L.layerGroup().addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      meLayerRef.current = L.layerGroup().addTo(map);
      infoLayerRef.current = L.layerGroup().addTo(map);
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
    for (const g of groupReports(reports)) {
      const icon = L.divIcon({
        className: "",
        html: markerHtml(g, highlightId),
        iconSize: [g.size, g.size],
        iconAnchor: [g.size / 2, g.size / 2],
      });
      L.marker([g.lat, g.lng], {
        icon,
        title: g.label,
        alt: g.label,
        keyboard: true,
        zIndexOffset: hasHighlight(g, highlightId) ? 1000 : 0,
      })
        .on("click", () => onSelectRef.current?.({ kind: "reports", group: g }))
        .addTo(layer);
    }
  }, [reportsKey, ready, highlightId]);

  // 대기질 측정소
  useEffect(() => {
    const L = leafletRef.current;
    const layer = airLayerRef.current;
    if (!L || !layer) return;
    layer.clearLayers();
    for (const st of air ?? []) {
      const b = airBadge(st);
      const icon = L.divIcon({
        className: "",
        html: b.html,
        iconSize: [b.width, b.height],
        iconAnchor: [b.width / 2, b.height / 2],
      });
      L.marker([st.lat, st.lng], { icon, pane: "air", title: b.title, alt: b.title, keyboard: true })
        .on("click", () => onSelectRef.current?.({ kind: "air", station: st }))
        .addTo(layer);
    }
  }, [air, ready]);

  // 날씨(바람 화살표): 측정소 배지 오른쪽 위로 비켜 놓는다 (CSS transform). 같은 "air" 층이라 제보 마커보다 아래
  useEffect(() => {
    const L = leafletRef.current;
    const layer = weatherLayerRef.current;
    if (!L || !layer) return;
    layer.clearLayers();
    for (const w of weather ?? []) {
      const b = weatherBadge(w);
      const icon = L.divIcon({
        className: "",
        html: b.html,
        iconSize: [b.width, b.height],
        iconAnchor: [b.width / 2, b.height / 2],
      });
      L.marker([w.lat, w.lng], { icon, pane: "air", title: b.title, alt: b.title, keyboard: true })
        .on("click", () => onSelectRef.current?.({ kind: "wind", point: w }))
        .addTo(layer);
    }
  }, [weather, ready]);

  // 내 위치 표시
  useEffect(() => {
    const L = leafletRef.current;
    const layer = meLayerRef.current;
    if (!L || !layer) return;
    layer.clearLayers();
    if (!me) return;
    const at: [number, number] = [me.lat, me.lng];
    const radius = accuracyRadius(me);
    if (radius > 0) {
      L.circle(at, { radius, color: "#2563eb", weight: 1, fillOpacity: 0.12, interactive: false }).addTo(layer);
    }
    L.circleMarker(at, { radius: 9, color: "#fff", weight: 3, fillColor: "#2563eb", fillOpacity: 1, interactive: false }).addTo(layer);
  }, [me, ready]);

  // 내 위치 위 대기·바람 아이콘 (마커 pane 안에서 제보 마커보다 위)
  useEffect(() => {
    const L = leafletRef.current;
    const layer = infoLayerRef.current;
    const map = mapRef.current;
    if (!L || !layer || !map) return;
    layer.clearLayers();
    if (!me || infoAnchor !== "me") return;
    const content = buildInfoContent("내 위치", me, air, weather);
    if (!content) return;
    const html = `<div class="info-anchor">${infoBubbleHtml(content, infoCollapsedRef.current)}</div>`;
    const icon = L.divIcon({ className: "info-icon", html, iconSize: [0, 0], iconAnchor: [0, 0] });
    const marker = L.marker([me.lat, me.lng], { icon, keyboard: false, zIndexOffset: 20000 }).addTo(layer);
    const root = marker.getElement();
    const reveal = (delay: number) =>
      setTimeout(() => {
        const btn = root?.querySelector<HTMLElement>(".info-bubble");
        if (!btn || mapRef.current !== map || !layer.hasLayer(marker)) return;
        const { dx, dy } = overflowPan(btn.getBoundingClientRect(), map.getContainer().getBoundingClientRect(), 12);
        if (dx || dy) map.panBy([dx, dy]);
      }, delay);
    if (root) {
      L.DomEvent.disableClickPropagation(root);
      bindInfoToggle(root, (collapsed) => {
        infoCollapsedRef.current = collapsed;
        if (!collapsed) reveal(0);
      });
    }
    if (!infoPannedRef.current) {
      infoPannedRef.current = true;
      reveal(500);
    }
  }, [me, air, weather, infoAnchor, ready]);

  // 보이는 범위: 내 위치가 있으면 그 중심, 없으면 강도 4 이상이 모인 곳 (없으면 전체 제보)
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    const mineGroup = reports ? findHighlightGroup(groupReports(reports), highlightId) : null;
    if (mineGroup) {
      map.setView([mineGroup.lat, mineGroup.lng], ME_ZOOM);
      return;
    }
    if (me) {
      map.setView([me.lat, me.lng], ME_ZOOM);
      return;
    }
    if (!reports) return;
    const focus = focusPoints(reports);
    if (focus.length) {
      map.fitBounds(L.latLngBounds(focus.map((p) => [p.lat, p.lng] as [number, number])), {
        padding: [40, 40],
        maxZoom: 15,
      });
    }
  }, [reportsKey, meKey, ready, highlightId]);

  // 선택된 마커에 링 (마커를 다시 만들지 않고 클래스만 바꾼다)
  useEffect(() => {
    applySelectedClass(mapEl.current, selectedKey);
  }, [selectedKey, reportsKey, air, weather, ready, highlightId]);

  // 숨겨 둔 탭이 다시 보이면 크기 다시 계산
  useEffect(() => {
    if (active) setTimeout(() => mapRef.current?.invalidateSize(), 0);
  }, [active]);

  return (
    <div className="map-frame">
      <div ref={mapEl} className={className} role="region" aria-label="악취 제보 지도" data-map-provider="leaflet" />
      {infoAnchor === "center" ? <CenterInfoCard center={center} air={air} weather={weather} /> : null}
      {belowMap}
    </div>
  );
}
