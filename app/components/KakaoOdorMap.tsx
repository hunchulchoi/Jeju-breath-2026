"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useRef, useState } from "react";
import {
  AEWOL_CENTER,
  accuracyRadius,
  airBadge,
  bindInfoToggle,
  buildInfoContent,
  infoBubbleHtml,
  findHighlightGroup,
  focusPoints,
  groupReports,
  hasHighlight,
  markerHtml,
  markerZ,
  overflowPan,
  applySelectedClass,
  weatherBadge,
  type OdorMapProps,
  type SelectProps,
} from "./odorMapCommon";
import { CenterInfoCard } from "./MapInfo";
import { KAKAO_LOAD_TIMEOUT_MS, loadKakao } from "./kakaoSdk";

const ME_LEVEL = 5;
const MAX_FIT_DETAIL_LEVEL = 4; // 제보가 한 곳이어도 이보다 더 확대하지 않는다
const Z_AIR = 1;
const Z_WEATHER = 2;
const Z_ME = 5;
const PAN_MARGIN = 12;
const Z_INFO = 950; // 제보 마커(<920)보다 위

function elementFromHtml(html: string): HTMLElement {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d.firstElementChild as HTMLElement;
}

/** 지도를 (dx, dy)px만큼 애니메이션 없이 옮긴다. 카카오 panBy(애니메이션)는 이동 중 열린 커스텀 오버레이(팝업)를 지워 버린다 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function shiftMap(kakao: any, map: any, dx: number, dy: number) {
  if (!dx && !dy) return;
  const proj = map.getProjection();
  const c = proj.containerPointFromCoords(map.getCenter());
  map.setCenter(proj.coordsFromContainerPoint(new kakao.maps.Point(c.x + dx, c.y + dy)));
}

/** 마지막으로 오버레이(마커·배지)를 누른 시각. 카카오 지도가 같은 누름을 '지도 클릭'으로도 받아 팝업을 바로 닫는 것을 막는다 */
let lastOverlayPress = 0;
export function overlayPressedRecently(now = Date.now()) {
  return now - lastOverlayPress < 500;
}

/** 마커 요소를 키보드로도 누를 수 있게 한다 */
function makeActivatable(el: HTMLElement, label: string, onActivate: () => void) {
  el.style.cursor = "pointer";
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");
  el.setAttribute("aria-label", label);
  el.title = label;
  // 누름이 지도로 전달되면 카카오가 지도 클릭(팝업 닫기)·끌기로 처리한다
  for (const type of ["pointerdown", "mousedown", "touchstart"] as const) {
    el.addEventListener(
      type,
      (e) => {
        lastOverlayPress = Date.now();
        e.stopPropagation();
      },
      { passive: true },
    );
  }
  el.addEventListener("click", (e) => {
    lastOverlayPress = Date.now();
    e.stopPropagation();
    onActivate();
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onActivate();
    }
  });
}

/**
 * 카카오맵 구현. SDK나 타일을 못 받으면 onFail을 불러 OdorMap이 Leaflet으로 바꾸게 한다.
 * - 성공 신호: 지도 타일이 실제로 그려졌다는 'tilesloaded' 이벤트. KAKAO_LOAD_TIMEOUT_MS 안에 안 오면 실패.
 */
export default function KakaoOdorMap({
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
  appKey,
  onFail,
}: OdorMapProps & SelectProps & { appKey: string; onFail: () => void }) {
  const mapEl = useRef<HTMLDivElement>(null);
  const kakaoRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const reportOvRef = useRef<any[]>([]);
  const airOvRef = useRef<any[]>([]);
  const weatherOvRef = useRef<any[]>([]);
  const meOvRef = useRef<any[]>([]);
  const infoOvRef = useRef<any>(null);
  const infoCollapsedRef = useRef(true);
  const [center, setCenterState] = useState<{ lat: number; lng: number } | null>(null);
  const [ready, setReady] = useState(0);
  const [provider, setProvider] = useState<"kakao-loading" | "kakao">("kakao-loading");
  const failRef = useRef(onFail);
  useEffect(() => {
    failRef.current = onFail;
  }, [onFail]);

  const onSelectRef = useRef(onSelect);
  const selectedKeyRef = useRef(selectedKey);
  useEffect(() => {
    onSelectRef.current = onSelect;
    selectedKeyRef.current = selectedKey;
  });
  // SDK 불러오기 + 지도 만들기. 어느 단계든 실패하면 onFail
  useEffect(() => {
    let disposed = false;
    let verifyTimer: ReturnType<typeof setTimeout> | undefined;
    let verified = false;
    const fail = () => {
      if (disposed || verified) return;
      disposed = true;
      failRef.current();
    };
    loadKakao(appKey)
      .then((kakao) => {
        if (disposed || !mapEl.current || mapRef.current) return;
        const map = new kakao.maps.Map(mapEl.current, {
          center: new kakao.maps.LatLng(AEWOL_CENTER.lat, AEWOL_CENTER.lng),
          level: 6,
        });
        map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
        kakao.maps.event.addListener(map, "click", () => {
          if (overlayPressedRecently()) return;
          onSelectRef.current?.(null);
        });
        const syncCenter = () => {
          const c = map.getCenter();
          setCenterState({ lat: c.getLat(), lng: c.getLng() });
        };
        kakao.maps.event.addListener(map, "idle", syncCenter);
        syncCenter();
        kakao.maps.event.addListener(map, "tilesloaded", () => {
          if (verified || disposed) return;
          verified = true;
          clearTimeout(verifyTimer);
          setProvider("kakao");
        });
        kakaoRef.current = kakao;
        mapRef.current = map;
        // 도메인 미등록 등으로 타일이 안 그려지면 일정 시간 뒤 실패로 본다
        // (숨겨진 탭처럼 크기가 0이면 타일을 그릴 수 없으므로 판단을 미룬다)
        const startedAt = Date.now();
        const check = () => {
          if (verified || disposed) return;
          if (!mapEl.current || mapEl.current.offsetWidth === 0) {
            verifyTimer = setTimeout(check, 1000);
            return;
          }
          // 지도를 연달아 옮기면(내 위치로 이동·확대 등) 타일 요청이 취소돼 'tilesloaded'가 안 올 수 있다.
          // 그려진 타일 이미지가 하나라도 있으면 카카오 지도가 동작하는 것으로 본다.
          const drawn = [...mapEl.current.querySelectorAll("img")].some(
            (img) => img.complete && img.naturalWidth > 0 && /(kakaocdn|daumcdn)\.net\/.*\/tile\//.test(img.src),
          );
          if (drawn) {
            verified = true;
            setProvider("kakao");
            return;
          }
          // 1초마다 다시 보고, 제한 시간이 지나도 그려진 타일이 없으면 실패로 본다
          if (Date.now() - startedAt < KAKAO_LOAD_TIMEOUT_MS) {
            verifyTimer = setTimeout(check, 1000);
            return;
          }
          fail();
        };
        verifyTimer = setTimeout(check, 1000);
        setReady((n) => n + 1);
      })
      .catch(fail);
    return () => {
      disposed = true;
      clearTimeout(verifyTimer);
      [reportOvRef, airOvRef, weatherOvRef, meOvRef].forEach((r) => r.current.forEach((o) => o.setMap(null)));
      infoOvRef.current?.setMap(null);
      infoOvRef.current = null;
      mapRef.current = null;
      kakaoRef.current = null;
    };
    // 나머지는 ref만 쓰므로 appKey가 바뀔 때만 다시 만든다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appKey]);

  // 제보 마커
  // 부모가 다시 그려질 때마다 내용이 같은 새 배열이 올 수 있다. 내용이 실제로 바뀐 경우에만 다시 그린다
  const meKey = me ? `${me.lat.toFixed(5)},${me.lng.toFixed(5)}` : "";
  const reportsKey = reports
    ? reports.map((r) => `${r.id}:${r.intensity}:${r.merged_count}:${r.needs_review ? 1 : 0}:${r.photo_ids.length}`).join("|")
    : "loading"; // 불러오는 중(null)과 빈 날짜([])를 구분해야 날짜를 바꿀 때 옛 마커가 지워진다
  useEffect(() => {
    const kakao = kakaoRef.current;
    const map = mapRef.current;
    if (!kakao || !map || !reports) return;
    reportOvRef.current.forEach((o) => o.setMap(null));
    reportOvRef.current = groupReports(reports).map((g, idx) => {
      const mine = hasHighlight(g, highlightId);
      const el = elementFromHtml(markerHtml(g, highlightId));
      makeActivatable(el, g.label, () => onSelectRef.current?.({ kind: "reports", group: g }));
      const ov = new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(g.lat, g.lng),
        content: el,
        xAnchor: 0.5,
        yAnchor: 0.5,
        // groupReports의 정렬 순서(확인 필요 → 약한 순 → 강한 순)대로 위에 쌓는다
        zIndex: markerZ(mine ? Number.MAX_SAFE_INTEGER : idx, g.top.needs_review), // 강조 칸은 같은 등급에서 맨 위
        clickable: true,
      });
      ov.setMap(map);
      return ov;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportsKey, ready, highlightId]);

  // 대기질 측정소 (제보 마커보다 아래)
  useEffect(() => {
    const kakao = kakaoRef.current;
    const map = mapRef.current;
    if (!kakao || !map) return;
    airOvRef.current.forEach((o) => o.setMap(null));
    airOvRef.current = (air ?? []).map((st) => {
      const b = airBadge(st);
      const el = elementFromHtml(b.html);
      makeActivatable(el, b.title, () => onSelectRef.current?.({ kind: "air", station: st }));
      const ov = new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(st.lat, st.lng),
        content: el,
        xAnchor: 0.5,
        yAnchor: 0.5,
        zIndex: Z_AIR,
        clickable: true,
      });
      ov.setMap(map);
      return ov;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [air, ready]);

  // 날씨(바람 화살표). 측정소 배지 오른쪽 위에 비켜 놓고, 제보 마커보다 아래
  useEffect(() => {
    const kakao = kakaoRef.current;
    const map = mapRef.current;
    if (!kakao || !map) return;
    weatherOvRef.current.forEach((o) => o.setMap(null));
    weatherOvRef.current = (weather ?? []).map((w) => {
      const b = weatherBadge(w);
      const el = elementFromHtml(b.html);
      makeActivatable(el, b.title, () => onSelectRef.current?.({ kind: "wind", point: w }));
      const ov = new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(w.lat, w.lng),
        content: el,
        xAnchor: 0.5,
        yAnchor: 0.5,
        zIndex: Z_WEATHER,
        clickable: true,
      });
      ov.setMap(map);
      return ov;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weather, ready]);

  // 내 위치: 파란 점 + 정확도 원
  useEffect(() => {
    const kakao = kakaoRef.current;
    const map = mapRef.current;
    if (!kakao || !map) return;
    meOvRef.current.forEach((o) => o.setMap(null));
    meOvRef.current = [];
    if (!me) return;
    const at = new kakao.maps.LatLng(me.lat, me.lng);
    const radius = accuracyRadius(me);
    if (radius > 0) {
      const circle = new kakao.maps.Circle({
        center: at,
        radius,
        strokeWeight: 1,
        strokeColor: "#2563eb",
        strokeOpacity: 0.8,
        fillColor: "#2563eb",
        fillOpacity: 0.12,
        zIndex: 0,
      });
      circle.setMap(map);
      meOvRef.current.push(circle);
    }
    const dot = document.createElement("div");
    dot.className = "me-dot";
    const ov = new kakao.maps.CustomOverlay({ position: at, content: dot, xAnchor: 0.5, yAnchor: 0.5, zIndex: Z_ME });
    ov.setMap(map);
    meOvRef.current.push(ov);
  }, [me, ready]);

  // 내 위치 위 대기·바람 아이콘 (제보 마커보다 위, 팝업보다 아래). 기본은 아이콘만, 누르면 설명이 펼쳐진다
  const infoPannedRef = useRef(false);
  useEffect(() => {
    const kakao = kakaoRef.current;
    const map = mapRef.current;
    if (!kakao || !map) return;
    infoOvRef.current?.setMap(null);
    infoOvRef.current = null;
    if (!me || infoAnchor !== "me") return;
    const content = buildInfoContent("내 위치", me, air, weather);
    if (!content) return;
    const wrap = document.createElement("div");
    wrap.className = "info-kakao";
    wrap.innerHTML = infoBubbleHtml(content, infoCollapsedRef.current);
    const reveal = (delay: number) =>
      setTimeout(() => {
        const btn = wrap.querySelector<HTMLElement>(".info-bubble");
        if (infoOvRef.current?.getContent() !== wrap || !btn || !mapEl.current) return;
        const { dx, dy } = overflowPan(btn.getBoundingClientRect(), mapEl.current.getBoundingClientRect(), PAN_MARGIN);
        shiftMap(kakaoRef.current, mapRef.current, dx, dy);
      }, delay);
    bindInfoToggle(wrap, (collapsed) => {
      infoCollapsedRef.current = collapsed;
      if (!collapsed) reveal(0);
    });
    infoOvRef.current = new kakao.maps.CustomOverlay({
      position: new kakao.maps.LatLng(me.lat, me.lng),
      content: wrap,
      xAnchor: 0.5,
      yAnchor: 1,
      zIndex: Z_INFO,
      clickable: true,
    });
    infoOvRef.current.setMap(map);
    if (!infoPannedRef.current) {
      infoPannedRef.current = true;
      reveal(400);
    }
  }, [me, air, weather, infoAnchor, ready]);

  // 보이는 범위: 내 위치가 있으면 그 중심, 없으면 강도 4 이상이 모인 곳 (측정소는 계산에서 뺀다)
  useEffect(() => {
    const kakao = kakaoRef.current;
    const map = mapRef.current;
    if (!kakao || !map) return;
    const mineGroup = reports ? findHighlightGroup(groupReports(reports), highlightId) : null;
    if (mineGroup) {
      map.setLevel(ME_LEVEL);
      map.setCenter(new kakao.maps.LatLng(mineGroup.lat, mineGroup.lng));
      return;
    }
    if (me) {
      map.setLevel(ME_LEVEL);
      map.setCenter(new kakao.maps.LatLng(me.lat, me.lng));
      return;
    }
    if (!reports) return;
    const focus = focusPoints(reports);
    if (!focus.length) return;
    const bounds = new kakao.maps.LatLngBounds();
    focus.forEach((p) => bounds.extend(new kakao.maps.LatLng(p.lat, p.lng)));
    map.setBounds(bounds, 40, 40, 40, 40);
    if (map.getLevel() < MAX_FIT_DETAIL_LEVEL) map.setLevel(MAX_FIT_DETAIL_LEVEL);
  }, [reportsKey, meKey, ready, highlightId]);

  // 선택된 마커에 링 (마커를 다시 만들지 않고 클래스만 바꾼다)
  useEffect(() => {
    applySelectedClass(mapEl.current, selectedKey);
  }, [selectedKey, reportsKey, air, weather, ready, highlightId]);

  // 숨겨 둔 탭이 다시 보이면 크기 다시 계산
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => {
      const map = mapRef.current;
      if (!map) return;
      const c = map.getCenter();
      map.relayout();
      map.setCenter(c);
    }, 0);
    return () => clearTimeout(t);
  }, [active]);

  return (
    <div className="map-frame">
      <div ref={mapEl} className={className} role="region" aria-label="악취 제보 지도" data-map-provider={provider} />
      {infoAnchor === "center" ? <CenterInfoCard center={center} air={air} weather={weather} /> : null}
      {belowMap}
    </div>
  );
}
