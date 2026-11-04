"use client";

import { useCallback, useState } from "react";
import OdorMap from "./OdorMap";
import { useAirStations, useShowAir } from "./AirToggle";
import { useShowWeather, useWeather } from "./WeatherToggle";
import type { PublicReport } from "@/lib/types";
import type { Coords, Loc } from "./useMyPosition";

/**
 * 홈 화면의 오늘 지도. 위치(GPS)는 묻지 않고, 대기·바람은 /map에서 정한 설정(기본 켜짐)을 따른다.
 * 토글·범례는 없다 (자세한 지도는 /map). 지도가 안 뜨면 안내 문구로 바꾼다.
 */
export function TodayMap({
  day,
  reports,
  kakaoKey,
  me,
  loc,
  onAskLocation,
}: {
  day: string;
  reports: PublicReport[] | null;
  kakaoKey: string;
  /** 동의 후 확인된 내 위치 */
  me: Coords | null;
  loc: Loc;
  /** 동의 기록이 없을 때 [내 위치 보기]를 누르면 부른다. 없으면 버튼을 그리지 않는다 */
  onAskLocation?: () => void;
}) {
  const [showAir] = useShowAir();
  const [showWeather] = useShowWeather();
  const { air } = useAirStations(day, showAir);
  const { weather } = useWeather(showWeather);
  const [failed, setFailed] = useState(false);
  const onTileFailed = useCallback(() => setFailed(true), []);

  if (failed) {
    return (
      <p className="notice" role="status">
        지도를 불러오지 못했어요. 아래 버튼은 그대로 쓸 수 있어요.
      </p>
    );
  }
  return (
    <>
      <div className="home-map-wrap">
        <OdorMap
          kakaoKey={kakaoKey}
          className="map home-map"
          infoAnchor={me ? "me" : "center"}
          reports={reports}
          me={me}
          onTileFailed={onTileFailed}
          air={showAir ? air : undefined}
          weather={showWeather ? weather : undefined}
        />
        {onAskLocation ? (
          <button type="button" className="btn home-locate" onClick={onAskLocation}>
            내 위치 보기
          </button>
        ) : null}
      </div>
      {loc === "error" ? (
        <p className="muted small" role="status">
          내 위치를 확인하지 못했어요. 지도 가운데 기준으로 보여 드려요.
        </p>
      ) : null}
    </>
  );
}
