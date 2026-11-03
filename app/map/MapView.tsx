"use client";

import { useEffect, useRef, useState } from "react";
import type { LayerGroup, Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import { TopBar } from "../components/TopBar";
import { formatTime } from "@/lib/time";
import { INTENSITY_COLORS, INTENSITY_LABELS, REVIEW_COLOR, type PublicReport, type Summary } from "@/lib/types";

const AEWOL_CENTER: [number, number] = [33.44, 126.33];

type Tab = "map" | "list";

function colorOf(r: PublicReport) {
  return r.needs_review ? REVIEW_COLOR : INTENSITY_COLORS[r.intensity];
}

function maxIntensity(group: PublicReport[]) {
  return Math.max(...group.map((r) => r.intensity));
}

function dayLabel(day: string, today: string) {
  const [, m, d] = day.split("-").map(Number);
  return day === today ? `오늘 (${m}월 ${d}일)` : `${m}월 ${d}일`;
}

function describe(r: PublicReport) {
  const parts = [
    `${formatTime(r.reported_at)}`,
    `강도 ${r.intensity} ${INTENSITY_LABELS[r.intensity].short}`,
    r.odor_type,
  ];
  if (r.symptoms.length) parts.push(r.symptoms.join(", "));
  return parts.join(" · ");
}

export default function MapView({
  days,
  initialDay,
  fromReport,
}: {
  days: string[];
  initialDay: string;
  fromReport: boolean;
}) {
  const [day, setDay] = useState(initialDay);
  const [tab, setTab] = useState<Tab>("map");
  const [reports, setReports] = useState<PublicReport[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [tileFailed, setTileFailed] = useState(false);
  const [mapReady, setMapReady] = useState(0);

  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);

  // 접수 화면에서 넘어온 지도 열람만 지표로 센다
  useEffect(() => {
    if (fromReport) {
      fetch("/api/events", { method: "POST", body: JSON.stringify({ name: "map_viewed" }) }).catch(() => {});
    }
  }, [fromReport]);

  // 날짜별 제보·요약 불러오기
  useEffect(() => {
    let cancelled = false;
    setReports(null);
    setLoadError(false);
    Promise.all([
      fetch(`/api/reports?date=${day}`).then((r) => (r.ok ? r.json() : Promise.reject())),
      fetch(`/api/summary?date=${day}`).then((r) => (r.ok ? r.json() : Promise.reject())),
    ])
      .then(([list, sum]: [{ reports: PublicReport[] }, Summary]) => {
        if (cancelled) return;
        setReports(list.reports);
        setSummary(sum);
      })
      .catch(() => !cancelled && setLoadError(true));
    return () => {
      cancelled = true;
    };
  }, [day]);

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
        // 타일이 하나도 안 뜨면 목록으로 자동 전환
        if (!anyTileLoaded) {
          setTileFailed(true);
          setTab("list");
        }
      });
      tiles.addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setMapReady((n) => n + 1);
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
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!L || !map || !layer || !reports) return;
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
        .map((r) => escapeHtml(describe(r)) + (r.merged_count > 1 ? ` (${r.merged_count}번 제보)` : ""));
      L.marker([top.grid_lat, top.grid_lng], { icon, title: label, alt: label, keyboard: true })
        .bindPopup(
          `<strong>이 근처 제보 ${count}건 · 최고 강도 ${top.intensity}</strong>` +
            (top.needs_review ? "<br><em>확인 필요 (요약에서 제외)</em>" : "") +
            `<br>${lines.join("<br>")}`,
        )
        .addTo(layer);
    }
    // 강도 4 이상이 모인 곳을 먼저 보여 준다. 없으면 전체 제보에 맞춘다.
    const valid = reports.filter((r) => !r.needs_review);
    const strongOnes = valid.filter((r) => r.intensity >= 4);
    const focus = strongOnes.length ? strongOnes : valid;
    if (focus.length) {
      map.fitBounds(L.latLngBounds(focus.map((r) => [r.grid_lat, r.grid_lng] as [number, number])), {
        padding: [40, 40],
        maxZoom: 15,
      });
    }
  }, [reports, mapReady]);

  // 목록 탭에서 지도로 돌아오면 크기 다시 계산
  useEffect(() => {
    if (tab === "map") setTimeout(() => mapRef.current?.invalidateSize(), 0);
  }, [tab]);

  const hasDemo = summary?.has_demo || reports?.some((r) => r.is_demo);

  return (
    <main className="container">
      <TopBar badges={hasDemo ? <span className="badge">시연 모드: 가상 데이터</span> : null} />
      <h1>날짜별 악취 제보 지도 (제보 기준)</h1>
      <p className="muted small">주민이 보낸 제보만 표시해요. 제보가 없다고 악취가 없었다는 뜻은 아니에요.</p>

      <div className="controls">
        <label>
          <span className="visually-hidden">날짜 선택</span>
          <select value={day} onChange={(e) => setDay(e.target.value)}>
            {days.map((d) => (
              <option key={d} value={d}>
                {dayLabel(d, days[0])}
              </option>
            ))}
          </select>
        </label>
        <div className="tabs" role="tablist">
          <button className="tab" role="tab" aria-selected={tab === "map"} onClick={() => setTab("map")}>
            지도
          </button>
          <button className="tab" role="tab" aria-selected={tab === "list"} onClick={() => setTab("list")}>
            목록
          </button>
        </div>
      </div>

      {tileFailed && tab === "list" ? (
        <p className="notice">지도를 불러오지 못해 목록으로 보여 드려요.</p>
      ) : null}
      {loadError ? <p className="notice">제보를 불러오지 못했어요. 잠시 뒤 다시 열어 주세요.</p> : null}

      <div hidden={tab !== "map"}>
        <div ref={mapEl} className="map" role="region" aria-label="악취 제보 지도" />
        <Legend />
      </div>

      {tab === "list" ? <ReportList reports={reports} /> : null}

      <p className="summary" aria-live="polite" style={{ marginTop: 12 }}>
        {summary
          ? `${day === days[0] ? "오늘" : dayLabel(day, days[0])} 제보 ${summary.total}건 · 강도 4 이상 ${summary.high_intensity}건 · 위치 실패 ${summary.location_failures}회(저장 안 함)`
          : "불러오는 중이에요"}
      </p>
      <p className="muted small">지도 위치는 약 200m 단위의 대략적인 위치예요. 원인이나 책임을 판단하지 않아요.</p>
    </main>
  );
}

function Legend() {
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
    </div>
  );
}

function ReportList({ reports }: { reports: PublicReport[] | null }) {
  if (!reports) return <p className="muted">불러오는 중이에요</p>;
  if (!reports.length) return <p className="card">이 날짜에는 제보가 없어요.</p>;
  return (
    <ul className="list">
      {reports.map((r) => (
        <li key={r.id}>
          <span
            className="dot"
            style={{ background: colorOf(r), color: !r.needs_review && r.intensity >= 4 ? "#fff" : undefined }}
          >
            {r.intensity}
          </span>
          <div>
            <strong>
              {formatTime(r.reported_at)} · 강도 {r.intensity} {INTENSITY_LABELS[r.intensity].short}
            </strong>
            <div>
              {r.odor_type}
              {r.symptoms.length ? ` · ${r.symptoms.join(", ")}` : ""}
            </div>
            {r.needs_review ? <div className="muted small">확인 필요 (요약에서 제외)</div> : null}
            {r.is_demo ? <div className="muted small">가상 데이터</div> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
