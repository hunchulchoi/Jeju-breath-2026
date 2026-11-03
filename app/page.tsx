import Link from "next/link";
import { TopBar } from "./components/TopBar";

export default function Home() {
  return (
    <main className="container">
      <TopBar />
      <h1>악취가 나면 한 문장으로 알려주세요</h1>
      <p className="muted">
        위치와 시각, 냄새 강도가 함께 기록돼요. 제보는 날짜별 지도에 쌓여 어디서 자주 냄새가 나는지 보여 줘요.
      </p>
      <div className="stack" style={{ marginTop: 24 }}>
        <Link href="/report" className="btn">
          제보하기
        </Link>
        <Link href="/map" className="btn secondary">
          오늘 지도 보기
        </Link>
      </div>
      <p className="muted small" style={{ marginTop: 24 }}>
        이름이나 연락처는 받지 않아요. 지도에는 약 200m 단위의 대략적인 위치만 보여요.
      </p>
    </main>
  );
}
