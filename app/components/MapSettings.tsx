"use client";

import type { ReactNode } from "react";
import { Legend } from "./OdorMap";
import { AirToggle } from "./AirToggle";
import { WeatherToggle } from "./WeatherToggle";
import { sourceLabel } from "@/lib/weather";

/**
 * 지도 바로 아래 접이식 "지도 설명·설정" (기본 닫힘).
 * 대기·날씨 토글, 범례(두 묶음), 출처 한 줄. children은 맨 위에 들어간다 (바람 요약, 시연 설정 등).
 */
export function MapSettings({
  showAir,
  onAir,
  airFailed,
  showWeather,
  onWeather,
  weatherFailed,
  weatherSource,
  notToday = false,
  withMe = false,
  withWeatherLegend,
  children,
  after,
}: {
  showAir: boolean;
  onAir: (v: boolean) => void;
  airFailed: boolean;
  showWeather: boolean;
  onWeather: (v: boolean) => void;
  weatherFailed: boolean;
  weatherSource?: string;
  notToday?: boolean;
  withMe?: boolean;
  /** 날씨 범례를 보일지 (기본: showWeather) */
  withWeatherLegend?: boolean;
  children?: ReactNode;
  /** 맨 아래에 들어가는 내용 (시연 설정) */
  after?: ReactNode;
}) {
  const weatherOn = withWeatherLegend ?? showWeather;
  const sources: string[] = [];
  if (showAir) sources.push("대기: 제주특별자치도 보건환경연구원");
  if (weatherOn && weatherSource) sources.push(`날씨: ${sourceLabel(weatherSource)}`);
  return (
    <details className="map-settings">
      <summary>지도 설명·설정</summary>
      <div className="stack">
        {children}
        <div className="group">
          <AirToggle show={showAir} onChange={onAir} failed={airFailed} />
          <WeatherToggle show={showWeather} onChange={onWeather} failed={weatherFailed} notToday={notToday} />
        </div>
        <Legend withMe={withMe} withAir={showAir} withWeather={weatherOn} />
        {sources.length ? <p className="muted small" style={{ margin: 0 }}>{sources.join(" · ")}</p> : null}
        {after}
      </div>
    </details>
  );
}
