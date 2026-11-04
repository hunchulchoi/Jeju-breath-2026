import { fetchWeather } from "@/lib/weather";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const { updated_at, points, source } = await fetchWeather();
    return NextResponse.json(
      { updated_at, points, source },
      { headers: { "Cache-Control": "public, max-age=300" } },
    );
  } catch (e) {
    // 지도는 계속 동작해야 하므로 200으로 빈 목록을 준다. 로그에는 에러 이름만 남긴다.
    console.error("weather fetch failed:", e instanceof Error ? e.name : "unknown");
    return NextResponse.json(
      { points: [], error: "날씨 정보를 불러오지 못했어요." },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
