"use client";

import { useEffect, useState } from "react";
import type { PublicReport, Summary } from "@/lib/types";

/** 날짜 하나의 제보 목록과 요약을 /api에서 불러온다 (/map과 홈이 함께 쓴다) */
export function useDayData(day: string) {
  const [reports, setReports] = useState<PublicReport[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loadError, setLoadError] = useState(false);
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
  return { reports, summary, loadError };
}
