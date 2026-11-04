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
  focusPoints,
  groupReports,
  markerHtml,
  markerZ,
  overflowPan,
  popupMaxSize,
  pickMeToo,
  reportPopupHtml,
  useLatestRefs,
  weatherBadge,
  type OdorMapProps,
} from "./odorMapCommon";
import { CenterInfoCard } from "./MapInfo";
import { KAKAO_LOAD_TIMEOUT_MS, loadKakao } from "./kakaoSdk";

const ME_LEVEL = 5;
const MAX_FIT_DETAIL_LEVEL = 4; // 제보가 한 곳이어도 이보다 더 확대하지 않는다
const Z_AIR = 1;
const Z_WEATHER = 2;
const Z_ME = 5;
const POPUP_MARGIN = 12;
const Z_INFO = 950; // 제보 마커(<920)보다 위, 팝업보다 아래
const Z_POPUP = 1000;

function elementFromHtml(html: string): HTMLElement {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d.firstElementChild as HTMLElement;
}

/** 마커 요소를 키보드로도 누를 수 있게 한다 */
function makeActivatable(el: HTMLElement, label: string, onActivate: () => void) {
  el.style.cursor = "pointer";
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");
  el.setAttribute("aria-label", label);
  el.title = label;
  el.addEventListener("click", (e) => {
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
  meToo,
  air,
  weather,
  infoAnchor = "me",
  appKey,
  onFail,
}: OdorMapProps & { appKey: string; onFail: () => void }) {
  const mapEl = useRef<HTMLDivElement>(null);
  const kakaoRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const reportOvRef = useRef<any[]>([]);
  const airOvRef = useRef<any[]>([]);
  const weatherOvRef = useRef<any[]>([]);
  const meOvRef = useRef<any[]>([]);
  const popupRef = useRef<any>(null);
  const infoOvRef = useRef<any>(null);
  const infoCollapsedRef = useRef(true);
  const [center, setCenterState] = useState<{ lat: number; lng: number } | null>(null);
  const [ready, setReady] = useState(0);
  const [provider, setProvider] = useState<"kakao-loading" | "kakao">("kakao-loading");
  const failRef = useRef(onFail);
  useEffect(() => {
    failRef.current = onFail;
  }, [onFail]);

  const { meTooRef, reportsRef } = useLatestRefs(reports, meToo);

  const closePopup = () => {
    popupRef.current?.setMap(null);
    popupRef.current = null;
  };

  /** 말풍선 팝업. content는 팝업 안쪽 HTML */
  const openPopup = (lat: number, lng: number, contentHtml: string, gap: number) => {
    const kakao = kakaoRef.current;
    const map = mapRef.current;
    if (!kakao || !map) return;
    closePopup();
    const wrap = document.createElement("div");
    wrap.className = "kakao-popup-wrap";
    wrap.style.paddingBottom = `${gap}px`;
    wrap.style.setProperty("--gap", `${gap}px`);
    const box = document.createElement("div");
    box.className = "kakao-popup";
    const body = document.createElement("div");
    body.className = "kakao-popup-body";
    body.innerHTML = contentHtml;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "kakao-popup-close";
    close.setAttribute("aria-label", "닫기");
    close.textContent = "×";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      closePopup();
    });
    box.append(close, body);
    wrap.append(box);
    body.querySelectorAll<HTMLButtonElement>("button[data-me-too]").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = Number(b.dataset.meToo);
        if (pickMeToo(id, meTooRef.current, reportsRef.current)) closePopup();
      }),
    );
    popupRef.current = new kakao.maps.CustomOverlay({
      position: new kakao.maps.LatLng(lat, lng),
      content: wrap,
      xAnchor: 0.5,
      yAnchor: 1,
      zIndex: Z_POPUP,
      clickable: true,
    });
    popupRef.current.setMap(map);

    // 지도 크기에 맞춰 말풍선 크기를 제한하고, 넘치는 만큼 지도를 옮겨 전체가 보이게 한다
    const mapBox = mapEl.current;
    if (mapBox) {
      const { maxWidth, maxHeight } = popupMaxSize(
        mapBox.clientWidth,
        mapBox.clientHeight,
        gap,
        POPUP_MARGIN,
        window.innerHeight,
      );
      box.style.maxWidth = `${maxWidth}px`;
      box.style.maxHeight = `${maxHeight}px`;
    }
    const current = popupRef.current;
    const reveal = () => {
      if (popupRef.current !== current || !mapEl.current) return;
      const p = box.getBoundingClientRect();
      const m = mapEl.current.getBoundingClientRect();
      const { dx, dy } = overflowPan(p, m, POPUP_MARGIN);
      if (dx || dy) mapRef.current?.panBy(dx, dy);
    };
    requestAnimationFrame(reveal);
    // 사진이 늦게 불러와져 크기가 바뀌면 한 번 더 맞춘다
    body.querySelectorAll("img").forEach((img) => img.addEventListener("load", reveal, { once: true }));
  };

  // 제출이 시작되면 열려 있는 팝업(버튼)을 닫는다
  const meTooDisabled = !!meToo?.disabled;
  useEffect(() => {
    if (meTooDisabled) {
      popupRef.current?.setMap(null);
      popupRef.current = null;
    }
  }, [meTooDisabled]);

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
          popupRef.current?.setMap(null);
          popupRef.current = null;
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
        const check = () => {
          if (verified || disposed) return;
          if (!mapEl.current || mapEl.current.offsetWidth === 0) {
            verifyTimer = setTimeout(check, 1000);
            return;
          }
          fail();
        };
        verifyTimer = setTimeout(check, KAKAO_LOAD_TIMEOUT_MS);
        setReady((n) => n + 1);
      })
      .catch(fail);
    return () => {
      disposed = true;
      clearTimeout(verifyTimer);
      [reportOvRef, airOvRef, weatherOvRef, meOvRef].forEach((r) => r.current.forEach((o) => o.setMap(null)));
      popupRef.current?.setMap(null);
      popupRef.current = null;
      infoOvRef.current?.setMap(null);
      infoOvRef.current = null;
      mapRef.current = null;
      kakaoRef.current = null;
    };
    // openPopup 등은 ref만 쓰므로 appKey가 바뀔 때만 다시 만든다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appKey]);

  // 제보 마커
  useEffect(() => {
    const kakao = kakaoRef.current;
    const map = mapRef.current;
    if (!kakao || !map || !reports) return;
    reportOvRef.current.forEach((o) => o.setMap(null));
    closePopup();
    reportOvRef.current = groupReports(reports).map((g, idx) => {
      const el = elementFromHtml(markerHtml(g));
      makeActivatable(el, g.label, () =>
        openPopup(g.lat, g.lng, reportPopupHtml(g, meTooRef.current), g.size / 2 + 8),
      );
      const ov = new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(g.lat, g.lng),
        content: el,
        xAnchor: 0.5,
        yAnchor: 0.5,
        // groupReports의 정렬 순서(확인 필요 → 약한 순 → 강한 순)대로 위에 쌓는다
        zIndex: markerZ(idx, g.top.needs_review),
        clickable: true,
      });
      ov.setMap(map);
      return ov;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reports, ready]);

  // 대기질 측정소 (제보 마커보다 아래)
  useEffect(() => {
    const kakao = kakaoRef.current;
    const map = mapRef.current;
    if (!kakao || !map) return;
    airOvRef.current.forEach((o) => o.setMap(null));
    airOvRef.current = (air ?? []).map((st) => {
      const b = airBadge(st);
      const el = elementFromHtml(b.html);
      makeActivatable(el, b.title, () => openPopup(st.lat, st.lng, b.popup, b.height / 2 + 8));
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
      makeActivatable(el, b.title, () => openPopup(w.lat, w.lng, b.popup, b.popupLift + 30));
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
        const { dx, dy } = overflowPan(btn.getBoundingClientRect(), mapEl.current.getBoundingClientRect(), POPUP_MARGIN);
        if (dx || dy) mapRef.current?.panBy(dx, dy);
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
  }, [reports, me, ready]);

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
    </div>
  );
}
