/* eslint-disable @typescript-eslint/no-explicit-any */

/** 카카오맵 JavaScript SDK를 한 번만 불러온다. 실패하면 거절(reject)한다 */
export const KAKAO_LOAD_TIMEOUT_MS = 8000;

let loading: Promise<any> | null = null;
let failed = false;

/** 이번 페이지 방문에서 카카오맵이 한 번이라도 실패했는가 (그러면 다시 시도하지 않고 Leaflet을 쓴다) */
export const kakaoFailed = () => failed;
export const markKakaoFailed = () => {
  failed = true;
};

export function loadKakao(appKey: string): Promise<any> {
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const w = window as any;
    const timer = setTimeout(() => reject(new Error("kakao sdk timeout")), KAKAO_LOAD_TIMEOUT_MS);
    const done = (fn: () => void) => {
      clearTimeout(timer);
      fn();
    };
    const ready = () => {
      if (!w.kakao?.maps?.load) return done(() => reject(new Error("kakao object missing")));
      w.kakao.maps.load(() => done(() => resolve(w.kakao)));
    };
    if (w.kakao?.maps?.load) return ready();
    const s = document.createElement("script");
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false`;
    s.async = true;
    s.onload = ready;
    s.onerror = () => done(() => reject(new Error("kakao sdk load error")));
    document.head.appendChild(s);
  });
  loading.catch(() => {
    failed = true;
  });
  return loading;
}
