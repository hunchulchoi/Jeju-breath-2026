import { connection } from "next/server";
import { seoulDay } from "@/lib/time";
import HomeView from "./HomeView";

// 서버에서는 DB를 조회하지 않는다 (healthcheck가 /를 친다). 지도 데이터는 클라이언트가 /api로 불러온다.
export default async function Home() {
  await connection();
  return <HomeView today={seoulDay(new Date())} kakaoKey={process.env.KAKAO_JS_KEY ?? ""} />;
}
