import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { clearAirCache, fetchJejuAir, latestBySite, parseJejuAirXml } from "@/lib/air";

const XML = readFileSync(new URL("./fixtures/jeju-air.xml", import.meta.url), "utf8");
const okFetcher = (calls: { n: number }) =>
  (async () => {
    calls.n++;
    return new Response(XML, { status: 200 });
  }) as unknown as typeof fetch;

beforeEach(() => clearAirCache());

describe("parseJejuAirXml", () => {
  it("행을 읽고 null·X는 null로 바꾼다", () => {
    const rows = parseJejuAirXml(XML);
    expect(rows).toHaveLength(7);
    expect(rows[1]).toMatchObject({ SITE: "716", DT10: "2026110321", PM10: "77", O3: "0.0438" });
    expect(rows[3].PM10).toBeNull();
    expect(rows[3].REP_CAI).toBeNull();
    expect(rows[5].REP_CAI).toBeNull();
    expect(rows[5].PM25).toBeNull();
  });
  it("resultCode가 00이 아니면 throw", () => {
    const bad = "<openapi><header><resultCode>30</resultCode><resultMsg>ERR</resultMsg></header></openapi>";
    expect(() => parseJejuAirXml(bad)).toThrow();
    expect(() => parseJejuAirXml("<html>oops</html>")).toThrow();
  });
});

describe("latestBySite", () => {
  const stations = latestBySite(parseJejuAirXml(XML));
  const by = (s: string) => stations.find((x) => x.site === s)!;
  it("측정소마다 가장 최근 시각을 고르고 모르는 SITE는 버린다", () => {
    expect(stations.map((s) => s.site)).toEqual(["716", "722", "725"]);
    expect(by("716")).toMatchObject({ name: "애월", cai: 2, pm10: 77, pm25: 17, o3: 0.0438, rep_item: "PM10" });
  });
  it("DT10을 KST ISO로 바꾼다", () => {
    expect(by("716").measured_at).toBe("2026-11-03T21:00:00+09:00");
  });
  it("REP_CAI가 null이면 측정된 모든 항목 등급 중 가장 나쁜 값, 하나도 없으면 null", () => {
    expect(by("722").cai).toBe(3);
    expect(by("722")).toMatchObject({ pm10: null, pm25: 40, o3: null, rep_item: null });
    expect(by("725").cai).toBeNull();
  });
  it("대표 등급이 없을 때 오존이 매우 나쁘면 미세먼지가 좋아도 매우나쁨 (Codex 리뷰)", () => {
    const xml = `<openapi><header><resultCode>00</resultCode><resultMsg>success</resultMsg></header><body><data><list>
      <SITE>711</SITE><DT10>2026110310</DT10><REP_ITEM>null</REP_ITEM><REP_CAI>null</REP_CAI>
      <PM10>20</PM10><PM10_CAI>1</PM10_CAI><PM25>8</PM25><PM25_CAI>1</PM25_CAI><O3>0.2</O3><O3_CAI>4</O3_CAI>
      <NO2>0.01</NO2><NO2_CAI>1</NO2_CAI><CO>0.3</CO><CO_CAI>1</CO_CAI><SO2>0.001</SO2><SO2_CAI>1</SO2_CAI>
    </list></data></body></openapi>`;
    expect(latestBySite(parseJejuAirXml(xml))[0].cai).toBe(4);
  });
  it("입력 순서와 상관없이 최신을 고른다", () => {
    const rows = parseJejuAirXml(XML).reverse();
    expect(latestBySite(rows).find((s) => s.site === "716")!.measured_at).toBe("2026-11-03T21:00:00+09:00");
  });
});

describe("fetchJejuAir", () => {
  it("같은 날짜는 10분 캐시로 한 번만 부른다", async () => {
    const calls = { n: 0 };
    const f = okFetcher(calls);
    let t = 1_000_000;
    await fetchJejuAir("2026-11-03", f, () => t);
    t += 5 * 60_000;
    await fetchJejuAir("2026-11-03", f, () => t);
    expect(calls.n).toBe(1);
    await fetchJejuAir("2026-11-02", f, () => t);
    expect(calls.n).toBe(2);
    t += 11 * 60_000;
    await fetchJejuAir("2026-11-03", f, () => t);
    expect(calls.n).toBe(3);
  });
  it("HTTP 오류·네트워크 오류·타임아웃·API 오류는 throw하고 캐시하지 않는다", async () => {
    const http = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    await expect(fetchJejuAir("2026-11-03", http)).rejects.toThrow();
    const timeout = (async () => {
      throw new DOMException("timed out", "TimeoutError");
    }) as unknown as typeof fetch;
    await expect(fetchJejuAir("2026-11-03", timeout)).rejects.toThrow();
    const apiErr = (async () =>
      new Response("<openapi><header><resultCode>30</resultCode></header></openapi>")) as unknown as typeof fetch;
    await expect(fetchJejuAir("2026-11-03", apiErr)).rejects.toThrow();
    const calls = { n: 0 };
    await fetchJejuAir("2026-11-03", okFetcher(calls));
    expect(calls.n).toBe(1);
  });
  it("5초 타임아웃 신호를 fetch에 넘기고 날짜를 YYYYMMDD로 보낸다", async () => {
    let url = "";
    let signal: AbortSignal | undefined;
    const f = (async (u: string, init?: RequestInit) => {
      url = u;
      signal = init?.signal ?? undefined;
      return new Response(XML);
    }) as unknown as typeof fetch;
    await fetchJejuAir("2026-11-03", f);
    expect(url).toContain("https://air.jeju.go.kr/");
    expect(url).toContain("date=20261103");
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});
