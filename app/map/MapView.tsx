"use client";

import { useCallback, useEffect, useState } from "react";
import OdorMap, { Legend, colorOf, photoSrc } from "../components/OdorMap";
import { AirSource, AirToggle, useAirStations, useShowAir } from "../components/AirToggle";
import { TopBar } from "../components/TopBar";
import { formatTime } from "@/lib/time";
import { INTENSITY_LABELS, type PublicReport, type Summary } from "@/lib/types";

type Tab = "map" | "list";

function dayLabel(day: string, today: string) {
  const [, m, d] = day.split("-").map(Number);
  return day === today ? `오늘 (${m}월 ${d}일)` : `${m}월 ${d}일`;
}

export default function MapView({
  days,
  initialDay,
  fromReport,
  kakaoKey,
}: {
  days: string[];
  initialDay: string;
  fromReport: boolean;
  kakaoKey: string;
}) {
  const [day, setDay] = useState(initialDay);
  const [tab, setTab] = useState<Tab>("map");
  const [reports, setReports] = useState<PublicReport[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [tileFailed, setTileFailed] = useState(false);
  const [showAir, setShowAir] = useShowAir();
  const { air, failed: airFailed } = useAirStations(day, showAir);

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

  // 타일이 하나도 안 뜨면 목록으로 자동 전환
  const onTileFailed = useCallback(() => {
    setTileFailed(true);
    setTab("list");
  }, []);

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
        <AirToggle show={showAir} onChange={setShowAir} failed={airFailed} />
        <OdorMap kakaoKey={kakaoKey} reports={reports} active={tab === "map"} onTileFailed={onTileFailed} air={showAir ? air : undefined} />
        <Legend withAir={showAir} />
        {showAir ? <AirSource /> : null}
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
            {r.photo_ids.length ? (
              <div className="thumbs">
                {r.photo_ids.map((id) => (
                  <a key={id} href={photoSrc(id)} target="_blank" rel="noopener">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photoSrc(id)} alt={`${formatTime(r.reported_at)} 제보 사진`} loading="lazy" />
                  </a>
                ))}
              </div>
            ) : null}
            {r.needs_review ? <div className="muted small">확인 필요 (요약에서 제외)</div> : null}
            {r.is_demo ? <div className="muted small">가상 데이터</div> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
