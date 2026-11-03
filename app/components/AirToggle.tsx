"use client";

import { useEffect, useState } from "react";
import type { AirStation } from "@/lib/types";

const KEY = "jbb_show_air";

/** [대기 정보 보기] 체크 상태 (기본 켜짐, localStorage에 기억) */
export function useShowAir() {
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

/** 켜져 있을 때만 /api/air를 불러온다. 실패해도 지도는 그대로 동작한다 */
export function useAirStations(day: string | null, enabled: boolean) {
  const [state, setState] = useState<{ key: string; air: AirStation[]; failed: boolean } | null>(null);
  const key = `${day}`;
  useEffect(() => {
    if (!enabled || !day) return;
    let cancelled = false;
    fetch(`/api/air?date=${day}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((body: { stations?: AirStation[]; error?: string }) => {
        if (!cancelled) setState({ key, air: body.stations ?? [], failed: !!body.error });
      })
      .catch(() => !cancelled && setState({ key, air: [], failed: true }));
    return () => {
      cancelled = true;
    };
  }, [day, enabled, key]);
  const current = enabled && state?.key === key ? state : null;
  return { air: current?.air, failed: !!current?.failed };
}

export function AirToggle({
  show,
  onChange,
  failed,
}: {
  show: boolean;
  onChange: (v: boolean) => void;
  failed: boolean;
}) {
  return (
    <div className="air-toggle">
      <label>
        <input type="checkbox" checked={show} onChange={(e) => onChange(e.target.checked)} />
        <span>대기 정보 보기</span>
      </label>
      {show && failed ? <p className="muted small" role="status">대기 정보를 불러오지 못했어요</p> : null}
    </div>
  );
}

export function AirSource() {
  return (
    <p className="muted small">대기 정보: 제주특별자치도 보건환경연구원 (일부 측정소는 대략적인 위치예요)</p>
  );
}
