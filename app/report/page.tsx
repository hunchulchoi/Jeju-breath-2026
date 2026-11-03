import { connection } from "next/server";
import { seoulDay } from "@/lib/time";
import ReportFlow from "./ReportFlow";

export default async function ReportPage() {
  await connection();
  // 시연 모드 토글은 DEMO_MODE=true일 때만 노출 (운영에서는 비활성)
  return <ReportFlow demoMode={process.env.DEMO_MODE === "true"} today={seoulDay(new Date())} kakaoKey={process.env.KAKAO_JS_KEY ?? ""} />;
}
