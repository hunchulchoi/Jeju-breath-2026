"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ConsentStep from "./report/ConsentStep";
import { hasConsent, saveConsent } from "./components/useConsent";
import { useMyPosition } from "./components/useMyPosition";
import { TodayMap } from "./components/TodayMap";
import { TopBar } from "./components/TopBar";
import { useDayData } from "./components/useDayData";

export default function HomeView({ today, kakaoKey }: { today: string; kakaoKey: string }) {
  const { reports, summary, loadError } = useDayData(today);
  // 동의 기록이 있을 때만 위치를 요청한다 (기록은 이 기기의 localStorage, 확인 전에는 null)
  const [consented, setConsented] = useState<boolean | null>(null);
  const [asking, setAsking] = useState(false);
  useEffect(() => setConsented(hasConsent()), []);
  const { coords, loc } = useMyPosition(consented === true);
  const hasDemo = summary?.has_demo || reports?.some((r) => r.is_demo);

  if (asking) {
    return (
      <main className="container">
        <TopBar />
        <p>
          <button type="button" className="linklike" onClick={() => setAsking(false)}>
            ← 지도로 돌아가기
          </button>
        </p>
        <ConsentStep
          onAgree={() => {
            saveConsent();
            setConsented(true);
            setAsking(false);
          }}
          onDecline={() => setAsking(false)}
        />
      </main>
    );
  }

  return (
    <main className="container">
      <TopBar badges={hasDemo ? <span className="badge">시연 모드: 가상 데이터</span> : null} />
      <h1>악취가 나면 알려주세요</h1>
      <p className="muted home-lead">위치와 냄새 세기만 고르면 돼요.</p>

      <TodayMap
        day={today}
        reports={reports}
        kakaoKey={kakaoKey}
        me={coords}
        loc={loc}
        onAskLocation={consented === false ? () => setAsking(true) : undefined}
      />
      <p className="small home-more">
        <Link href="/map">범례와 자세한 지도 보기 →</Link>
      </p>

      <p className="summary" aria-live="polite">
        {summary
          ? summary.total === 0
            ? "오늘은 아직 제보가 없어요"
            : `오늘 제보 ${summary.total}건 · 강도 4 이상 ${summary.high_intensity}건`
          : loadError
            ? "제보 현황을 불러오지 못했어요"
            : "불러오는 중이에요"}
      </p>

      <div className="stack" style={{ marginTop: 16 }}>
        <Link href="/report" className="btn">
          제보하기
        </Link>
        <Link href="/map" className="btn secondary">
          지도 크게 보기
        </Link>
        <Link href="/stats" className="btn secondary">
          통계 보기
        </Link>
      </div>
      <p className="muted small" style={{ marginTop: 24 }}>
        이름이나 연락처는 받지 않아요. 지도에는 약 200m 단위의 대략적인 위치만 보여요.
      </p>
    </main>
  );
}
