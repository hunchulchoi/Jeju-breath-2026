import { describe, expect, it } from "vitest";
import { readBodyLimited } from "@/lib/http";

function streamRequest(chunks: Uint8Array[]) {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(ch);
      c.close();
    },
  });
  return new Request("http://localhost/x", { method: "POST", body: stream, duplex: "half" } as RequestInit);
}

describe("readBodyLimited", () => {
  it("한도 이하면 그대로 돌려준다", async () => {
    const req = streamRequest([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])]);
    expect(req.headers.get("content-length")).toBeNull();
    expect([...(await readBodyLimited(req, 5))!]).toEqual([1, 2, 3, 4, 5]);
  });

  it("한도를 넘으면 null (Content-Length 없는 스트림)", async () => {
    const req = streamRequest([new Uint8Array(4), new Uint8Array(4)]);
    expect(await readBodyLimited(req, 5)).toBeNull();
  });

  it("본문이 없으면 빈 배열", async () => {
    const out = await readBodyLimited(new Request("http://localhost/x"), 5);
    expect(out).toEqual(new Uint8Array(0));
  });
});
