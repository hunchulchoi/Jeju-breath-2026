"use client";

import { useEffect, useState } from "react";
import { distanceMeters } from "@/lib/rules";
import type { WeatherPoint } from "@/lib/types";
import { isCalm, sourceLabel, windFromLabel } from "@/lib/weather";

const KEY = "jbb_show_weather";
/** 위치를 모를 때 기준이 되는 지점 (애월, 시연 마을 근처) */
export const DEFAULT_WEATHER_SITE = "716";

/** [날씨 보기] 체크 상태 (기본 켜짐, localStorage에 기억) */
export function useShowWeather() {
  const [show, setShow] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) === "0") setShow(false);
    } catch {
      // 저장소를 못 써도 화면은 동작한다
    }
  }, []);
  const update = (v: boolean) => {
    setShow(v);
    try {
      localStorage.setItem(KEY, v ? "1" : "0");
    } catch {
      // 기억하지 못해도 이번에는 적용된다
    }
  };
  return [show, update] as const;
}

/** 켜져 있을 때만 /api/weather를 불러온다. 실패해도 지도는 그대로 동작한다 */
export function useWeather(enabled: boolean) {
  const [state, setState] = useState<{ points: WeatherPoint[]; failed: boolean; source?: string } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch("/api/weather")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((body: { points?: WeatherPoint[]; error?: string; source?: string }) => {
        if (!cancelled) setState({ points: body.points ?? [], failed: !!body.error, source: body.source });
      })
      .catch(() => !cancelled && setState({ points: [], failed: true }));
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  const current = enabled ? state : null;
  return { weather: current?.points, failed: !!current?.failed, source: current?.source };
}

export function WeatherToggle({
  show,
  onChange,
  failed,
  notToday = false,
}: {
  show: boolean;
  onChange: (v: boolean) => void;
  failed: boolean;
  notToday?: boolean;
}) {
  return (
    <div className="air-toggle">
      <label>
        <input type="checkbox" checked={show} onChange={(e) => onChange(e.target.checked)} />
        <span>날씨 보기</span>
      </label>
      {show && notToday ? <p className="muted small">날씨는 오늘만 보여요</p> : null}
      {show && !notToday && failed ? <p className="muted small" role="status">날씨 정보를 불러오지 못했어요</p> : null}
    </div>
  );
}

export function WeatherSource({ source }: { source?: string }) {
  if (!source) return null;
  return <p className="muted small">날씨: {sourceLabel(source)}</p>;
}

/** 기준 지점: 내 위치가 있으면 가장 가까운 지점, 없으면 애월 */
export function pickBasePoint(points: WeatherPoint[], origin: { lat: number; lng: number } | null): WeatherPoint | null {
  if (!points.length) return null;
  if (origin) {
    return points.reduce((best, p) => (distanceMeters(origin, p) < distanceMeters(origin, best) ? p : best));
  }
  return points.find((p) => p.site === DEFAULT_WEATHER_SITE) ?? points[0];
}

/** 지도 위 한 줄 요약 */
export function WindSummary({
  points,
  origin,
}: {
  points: WeatherPoint[] | undefined;
  origin: { lat: number; lng: number } | null;
}) {
  const p = points ? pickBasePoint(points, origin) : null;
  if (!p) return null;
  const wind =
    p.wind_speed === null || p.wind_dir === null
      ? "바람 정보 없음"
      : isCalm(p.wind_speed)
        ? "바람 거의 없음"
        : `${windFromLabel(p.wind_dir)} ${Math.round(p.wind_speed)}m/s`;
  const parts = [wind];
  if (p.temp !== null) parts.push(`${Math.round(p.temp)}℃`);
  if (p.humidity !== null) parts.push(`습도 ${Math.round(p.humidity)}%`);
  parts.push(p.sky);
  return (
    <p className="wind-summary" aria-live="polite">
      <strong>지금 바람:</strong> {parts.join(" · ")} ({p.name} 기준)
    </p>
  );
}
