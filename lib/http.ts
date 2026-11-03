import { NextResponse } from "next/server";
import { isValidDay, seoulDay } from "./time";

export function json<T>(data: T, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function error(message: string, status = 400) {
  return json({ error: message }, status);
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/** ?date=YYYY-MM-DD, 없으면 오늘(서울). 형식이 틀리면 null */
export function dayParam(req: Request): string | null {
  const date = new URL(req.url).searchParams.get("date");
  if (date === null) return seoulDay(new Date());
  return isValidDay(date) ? date : null;
}
