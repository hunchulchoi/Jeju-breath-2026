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

/**
 * 요청 본문을 limit 바이트까지만 읽는다. 넘으면 읽기를 취소하고 null.
 * Content-Length가 없는 청크 전송도 메모리를 limit 이상 쓰지 않는다.
 */
export async function readBodyLimited(req: Request, limit: number): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
