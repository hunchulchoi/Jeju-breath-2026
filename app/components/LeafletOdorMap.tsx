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
  findHighlightGroup,
  focusPoints,
  groupReports,
  hasHighlight,
  markerHtml,
  pickMeToo,
  reportPopupHtml,
  useLatestRefs,
  weatherBadge,
  type OdorMapProps,
} from "./odorMapCommon";
import { CenterInfoCard } from "./MapInfo";

const ME_ZOOM = 14;

/** Leaflet + OpenStreetMap 구현 (카카오맵을 못 쓸 때의 대체) */
export default function LeafletOdorMap({
  reports,
  me = null,
  active = true,
  className = "map",
  meToo,
  air,
  weather,
  infoAnchor = "me",
  highlightId,
  onTileFailed,
}: OdorMapProps & { onTileFailed?: () => void }) {
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

  const { meTooRef, reportsRef } = useLatestRefs(reports, meToo);
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
      // 팝업이 열릴 때마다 새로 만들어진 버튼에 직접 클릭 리스너를 붙인다
      // (팝업은 클릭 전파를 막아서 지도 컨테이너 위임은 쓸 수 없다. 팝업을 닫으면 요소째 버려진다)
      const onMeTooClick = (ev: Event) => {
        const id = Number((ev.currentTarget as HTMLElement).dataset.meToo);
        if (!pickMeToo(id, meTooRef.current, reportsRef.current)) return;
        map.closePopup();
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
  }, [meTooRef, reportsRef]);

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
        .bindPopup(() => reportPopupHtml(g, meTooRef.current))
        .addTo(layer);
    }
  }, [reports, ready, meTooRef, highlightId]);

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
        .bindPopup(() => b.popup)
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
        popupAnchor: [62, -34 - b.popupLift],
      });
      L.marker([w.lat, w.lng], { icon, pane: "air", title: b.title, alt: b.title, keyboard: true })
        .bindPopup(() => b.popup)
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

  // 내 위치 위 대기·바람 아이콘 (마커 pane 안에서 제보 마커보다 위, 팝업 pane보다 아래)
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
  }, [reports, me, ready, highlightId]);

  // 숨겨 둔 탭이 다시 보이면 크기 다시 계산
  useEffect(() => {
    if (active) setTimeout(() => mapRef.current?.invalidateSize(), 0);
  }, [active]);

  return (
    <div className="map-frame">
      <div ref={mapEl} className={className} role="region" aria-label="악취 제보 지도" data-map-provider="leaflet" />
      {infoAnchor === "center" ? <CenterInfoCard center={center} air={air} weather={weather} /> : null}
    </div>
  );
}
