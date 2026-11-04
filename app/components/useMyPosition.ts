"use client";

import { useEffect, useState } from "react";

export interface Coords {
  lat: number;
  lng: number;
  accuracy: number;
}
export type Loc = "idle" | "loading" | "ok" | "error";

export function getPosition(): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("unsupported"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(e),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  });
}

/**
 * 내 위치 한 번 확인. enabled가 true가 될 때만 위치를 요청한다 (동의 전에는 false로 둔다).
 * demo가 있으면 실제 위치 대신 그 좌표를 쓴다. retry가 바뀌면 다시 요청한다. 실패하면 onFail을 부른다.
 */
export function useMyPosition(
  enabled: boolean,
  opts: { demo?: Coords | null; retry?: number; onFail?: () => void } = {},
) {
  const { demo = null, retry = 0, onFail } = opts;
  const [state, setState] = useState<{ coords: Coords | null; loc: Loc }>({ coords: null, loc: "idle" });
  useEffect(() => {
    if (!enabled) {
      setState({ coords: null, loc: "idle" });
      return;
    }
    let cancelled = false;
    setState({ coords: null, loc: "loading" });
    (demo ? Promise.resolve(demo) : getPosition())
      .then((coords) => !cancelled && setState({ coords, loc: "ok" }))
      .catch(() => {
        if (cancelled) return;
        onFail?.();
        setState({ coords: null, loc: "error" });
      });
    return () => {
      cancelled = true;
    };
    // onFail은 매 렌더 새로 만들어도 다시 요청하지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, demo, retry]);
  return state;
}
