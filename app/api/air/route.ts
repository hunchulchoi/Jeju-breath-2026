import { fetchJejuAir, AIR_SOURCE } from "@/lib/air";
import { dayParam, error } from "@/lib/http";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const day = dayParam(req);
  if (!day) return error("date는 YYYY-MM-DD 형식이어야 해요.");
  try {
    const stations = await fetchJejuAir(day);
    return NextResponse.json(
      { date: day, stations, source: AIR_SOURCE },
      { headers: { "Cache-Control": "public, max-age=300" } },
    );
  } catch (e) {
    // 지도는 계속 동작해야 하므로 200으로 빈 목록을 준다. 로그에는 에러 이름만 남긴다.
    console.error("air fetch failed:", e instanceof Error ? e.name : "unknown");
    return NextResponse.json(
      { date: day, stations: [], error: "대기 정보를 불러오지 못했어요." },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
