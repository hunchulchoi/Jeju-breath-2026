"use client";

import { useCallback, useState } from "react";
import { INTENSITY_COLORS, INTENSITY_LABELS, INTENSITY_TEXT, REVIEW_COLOR } from "@/lib/types";
import KakaoOdorMap from "./KakaoOdorMap";
import LeafletOdorMap from "./LeafletOdorMap";
import { kakaoFailed, markKakaoFailed } from "./kakaoSdk";
import type { OdorMapProps } from "./odorMapCommon";

export { colorOf, photoSrc } from "./odorMapCommon";
export type { MeToo, MyPosition } from "./odorMapCommon";

/**
 * 오늘 제보 지도 (/map과 /report가 함께 쓴다).
 * 공급자 선택: kakaoKey가 있고 카카오맵이 아직 실패한 적이 없으면 카카오맵, 아니면 Leaflet+OSM.
 * 카카오맵은 SDK 로드 실패(스크립트 오류·8초 초과·kakao 객체 없음)나 타일 미표시(도메인 미등록 등)면
 * 스스로 실패를 알리고, 그러면 같은 자리에서 Leaflet으로 바뀐다 (실패는 방문 동안 기억해 다시 시도하지 않는다).
 * 지도 컨테이너의 data-map-provider에 "kakao"(타일 확인됨) | "kakao-loading" | "leaflet"이 남는다.
 * onTileFailed(타일이 하나도 안 뜨면 목록 전환)는 Leaflet일 때만 불린다.
 */
export default function OdorMap({
  kakaoKey,
  onTileFailed,
  ...props
}: OdorMapProps & { onTileFailed?: () => void; kakaoKey?: string }) {
  const [, rerender] = useState(0);
  const onKakaoFail = useCallback(() => {
    markKakaoFailed();
    rerender((n) => n + 1);
  }, []);
  if (kakaoKey && !kakaoFailed()) {
    return <KakaoOdorMap {...props} appKey={kakaoKey} onFail={onKakaoFail} />;
  }
  return <LeafletOdorMap {...props} onTileFailed={onTileFailed} />;
}

export function Legend({ withMe = false, withAir = false, withWeather = false }: { withMe?: boolean; withAir?: boolean; withWeather?: boolean }) {
  const items = [1, 2, 3, 4, 5];
  return (
    <div className="legend" aria-label="범례">
      {items.map((n) => (
        <span key={n}>
          <span className="dot" style={{ background: INTENSITY_COLORS[n], color: INTENSITY_TEXT[n] }}>
            {n}
          </span>
          {INTENSITY_LABELS[n].short}
        </span>
      ))}
      <span>
        <span className="dot" style={{ background: REVIEW_COLOR }}>?</span>
        확인 필요
      </span>
      {withMe ? (
        <span>
          <span className="dot" style={{ background: "#2563eb", border: "3px solid #fff", boxShadow: "0 0 0 1px #2563eb" }} />
          내 위치
        </span>
      ) : null}
      {withAir ? (
        <span>
          <span className="air-swatch" aria-hidden="true" />
          대기질 측정소
        </span>
      ) : null}
      {withWeather ? (
        <span>
          <span className="wind-swatch" aria-hidden="true">↗</span>
          바람(불어 가는 쪽)
        </span>
      ) : null}
    </div>
  );
}
