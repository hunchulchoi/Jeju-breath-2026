"use client";

import { useRef } from "react";
import type { AirStation, WeatherPoint } from "@/lib/types";
import { buildInfoContent, infoBubbleHtml, toggleInfoButton } from "./odorMapCommon";

/**
 * 지도 왼쪽 위 카드: 지도 가운데 기준 대기·바람 아이콘. 아이콘을 누르면 설명이 펼쳐진다.
 * 보여 줄 내용이 없으면(대기·날씨 둘 다 꺼짐/없음) 그리지 않는다.
 */
export function CenterInfoCard({
  center,
  air,
  weather,
}: {
  center: { lat: number; lng: number } | null;
  air?: AirStation[];
  weather?: WeatherPoint[];
}) {
  const collapsedRef = useRef(true);
  const content = center ? buildInfoContent("지도 가운데", center, air, weather) : null;
  if (!content) return null;
  return (
    <div
      className="info-card"
      onClick={(e) => {
        const btn = (e.target as HTMLElement).closest<HTMLElement>(".info-bubble");
        if (btn) collapsedRef.current = toggleInfoButton(btn);
      }}
      dangerouslySetInnerHTML={{ __html: infoBubbleHtml(content, collapsedRef.current, true) }}
    />
  );
}
