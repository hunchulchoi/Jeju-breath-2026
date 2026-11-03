import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { getDraft } from "@/lib/kakao";
import ReportFlow from "./ReportFlow";

export default async function ReportPage({ searchParams }: { searchParams: Promise<{ d?: string | string[] }> }) {
  await connection();
  const { d } = await searchParams;
  const token = typeof d === "string" ? d : undefined;
  let draft: { token: string; text: string } | null = null;
  let draftExpired = false;
  if (token) {
    // DB 오류가 나도 화면은 열리게 한다 (일반 입력으로 시작)
    try {
      const found = await getDraft(await getDb(), token);
      if (found) draft = { token: found.token, text: found.text };
      else draftExpired = true;
    } catch (e) {
      console.error("[kakao] 초안 조회 실패", (e as Error).name);
      draftExpired = true;
    }
  }
  // 시연 모드 토글은 DEMO_MODE=true일 때만 노출 (운영에서는 비활성)
  return <ReportFlow demoMode={process.env.DEMO_MODE === "true"} draft={draft} draftExpired={draftExpired} />;
}
