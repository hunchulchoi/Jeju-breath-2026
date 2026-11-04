import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearWeatherCache,
  fetchWeather,
  kmaBaseTime,
  latLngToGrid,
  parseKmaNcst,
  ptyText,
  isCalm,
  parseWeather,
  weatherText,
  windDirName,
  windFromLabel,
  windToDeg,
} from "@/lib/weather";
import { AIR_SITES } from "@/lib/air";

const N = Object.keys(AIR_SITES).length;
const cur = (i: number) => ({
  latitude: 33,
  longitude: 126,
  current: {
    time: "2026-11-04T09:30",
    temperature_2m: 10 + i,
    relative_humidity_2m: 70,
    wind_speed_10m: 3.2,
    wind_direction_10m: 45,
    weather_code: 3,
  },
});
const arrayBody = () => Array.from({ length: N }, (_, i) => cur(i));
const fetcherOf = (body: unknown, calls: { n: number }, status = 200) =>
  (async () => {
    calls.n++;
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;

beforeEach(() => {
  clearWeatherCache();
  delete process.env.KMA_AUTH_KEY;
});
afterEach(() => {
  delete process.env.KMA_AUTH_KEY;
  vi.restoreAllMocks();
});

describe("parseWeather", () => {
  it("배열 응답을 지점 순서대로 읽는다", () => {
    const r = parseWeather(arrayBody(), 0);
    expect(r.points).toHaveLength(N);
    expect(r.updated_at).toBe("2026-11-04T09:30:00+09:00");
    expect(r.points[0]).toMatchObject({ site: "711", name: "이도동", temp: 10, humidity: 70, wind_speed: 3.2, wind_dir: 45, sky: "흐림", rain_1h: null, source: "Open-Meteo" });
    expect(r.points[5]).toMatchObject({ site: "716", name: "애월", temp: 15 });
  });
  it("단일 객체 응답도 처리한다 (지점이 하나일 때의 모양)", () => {
    const r = parseWeather(cur(0), 0, ["716"]);
    expect(r.points).toHaveLength(1);
    expect(r.points[0]).toMatchObject({ site: "716", name: "애월", temp: 10 });
    // 지점 수가 다르면 거부
    expect(() => parseWeather(cur(0), 0)).toThrow();
  });
  it("값이 없으면 null", () => {
    const body = arrayBody();
    (body[0].current as Record<string, unknown>).wind_speed_10m = null;
    expect(parseWeather(body, 0).points[0].wind_speed).toBeNull();
  });
  it("current가 없으면 throw", () => {
    expect(() => parseWeather(Array.from({ length: N }, () => ({})), 0)).toThrow();
  });
  it("time이 없으면 now를 KST로", () => {
    const body = arrayBody();
    delete (body[0].current as Record<string, unknown>).time;
    expect(parseWeather(body, Date.UTC(2026, 10, 4, 0, 5)).points[0].at).toBe("2026-11-04T09:05:00+09:00");
  });
});

describe("fetchWeather", () => {
  it("10분 캐시로 한 번만 부른다", async () => {
    const calls = { n: 0 };
    const f = fetcherOf(arrayBody(), calls);
    let t = 1_000_000;
    await fetchWeather(f, () => t);
    t += 5 * 60_000;
    await fetchWeather(f, () => t);
    expect(calls.n).toBe(1);
    t += 6 * 60_000;
    await fetchWeather(f, () => t);
    expect(calls.n).toBe(2);
  });
  it("HTTP 오류면 throw하고 캐시하지 않는다", async () => {
    const calls = { n: 0 };
    await expect(fetchWeather(fetcherOf({}, calls, 500))).rejects.toThrow();
    await expect(fetchWeather(fetcherOf({}, calls, 500))).rejects.toThrow();
    expect(calls.n).toBe(2);
  });
  it("타임아웃(중단)이면 throw", async () => {
    const f = (async () => {
      throw new DOMException("timeout", "TimeoutError");
    }) as unknown as typeof fetch;
    await expect(fetchWeather(f)).rejects.toThrow();
  });
  it("지점 좌표를 한 번에 요청한다", async () => {
    let url = "";
    const f = (async (u: string) => {
      url = u;
      return new Response(JSON.stringify(arrayBody()));
    }) as unknown as typeof fetch;
    await fetchWeather(f);
    expect(url).toContain("latitude=33.50028,");
    expect(url).toContain("wind_speed_unit=ms");
    expect(url).toContain("timezone=Asia%2FSeoul");
  });
});

describe("바람 유틸", () => {
  it("windFromLabel 경계값", () => {
    expect(windFromLabel(0)).toBe("북풍");
    expect(windFromLabel(22.4)).toBe("북풍");
    expect(windFromLabel(22.5)).toBe("북동풍");
    expect(windFromLabel(45)).toBe("북동풍");
    expect(windFromLabel(337.4)).toBe("북서풍");
    expect(windFromLabel(337.5)).toBe("북풍");
    expect(windFromLabel(359)).toBe("북풍");
    expect(windFromLabel(360)).toBe("북풍");
    expect(windFromLabel(180)).toBe("남풍");
    expect(windDirName(270)).toBe("서");
  });
  it("windToDeg는 반대 방향", () => {
    expect(windToDeg(0)).toBe(180);
    expect(windToDeg(45)).toBe(225);
    expect(windToDeg(180)).toBe(0);
    expect(windToDeg(270)).toBe(90);
    expect(windToDeg(359)).toBe(179);
  });
  it("weatherText", () => {
    expect(weatherText(0)).toBe("맑음");
    expect(weatherText(2)).toBe("구름 조금");
    expect(weatherText(3)).toBe("흐림");
    expect(weatherText(45)).toBe("안개");
    expect(weatherText(53)).toBe("이슬비");
    expect(weatherText(63)).toBe("비");
    expect(weatherText(73)).toBe("눈");
    expect(weatherText(81)).toBe("소나기");
    expect(weatherText(95)).toBe("뇌우");
    expect(weatherText(null)).toBe("정보 없음");
  });
  it("0.5m/s 미만은 바람 거의 없음", () => {
    expect(isCalm(0.49)).toBe(true);
    expect(isCalm(0.5)).toBe(false);
    expect(isCalm(null)).toBe(false);
  });
});

// ---- 기상청 초단기실황 ----
const KEY = "SECRET-KEY-123";
const NOW = Date.UTC(2026, 10, 4, 0, 50); // 서울 09:50 -> base 0900

const kmaBody = (over: Record<string, string> = {}) => {
  const v: Record<string, string> = { T1H: "18.1", RN1: "0", UUU: "1", VVV: "1", REH: "65", PTY: "0", VEC: "45", WSD: "3.2", ...over };
  return {
    response: {
      header: { resultCode: "00", resultMsg: "NORMAL_SERVICE" },
      body: {
        dataType: "JSON",
        items: { item: Object.entries(v).map(([category, obsrValue]) => ({ baseDate: "20261104", baseTime: "0900", category, nx: 49, ny: 37, obsrValue })) },
        pageNo: 1,
        numOfRows: 100,
        totalCount: 8,
      },
    },
  };
};
const forbidden = { result: { status: 403, message: "활용신청이 필요한 API 입니다." } };

/** URL별로 응답을 만드는 가짜 fetcher. 기상청 URL이면 kma(url), 아니면 Open-Meteo 배열 */
function routed(kma: (url: string) => Response) {
  const urls: string[] = [];
  const f = (async (u: string) => {
    urls.push(u);
    return u.includes("apihub.kma.go.kr") ? kma(u) : new Response(JSON.stringify(arrayBody()));
  }) as unknown as typeof fetch;
  return { f, urls, kmaCalls: () => urls.filter((u) => u.includes("apihub.kma.go.kr")).length };
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

describe("latLngToGrid (기상청 LCC 변환)", () => {
  it("애월(33.46469,126.33149) -> (49,37)", () => {
    expect(latLngToGrid(33.46469, 126.33149)).toEqual({ nx: 49, ny: 37 });
  });
  it("제주시청(33.50028,126.53251) -> (53,38)", () => {
    // 기상청 공식 변환식(RE=6371.00877, GRID=5, SLAT1=30, SLAT2=60, OLON=126, OLAT=38, XO=43, YO=136)을 그대로 계산한 값.
    // 제주시 일대 격자가 (52~53, 38)로 알려진 것과도 맞는다.
    expect(latLngToGrid(33.50028, 126.53251)).toEqual({ nx: 53, ny: 38 });
  });
});

describe("kmaBaseTime", () => {
  const kst = (h: number, m: number, d = 4) => Date.UTC(2026, 10, d, h - 9, m);
  it("09:39 -> 0800", () => expect(kmaBaseTime(kst(9, 39))).toEqual({ base_date: "20261104", base_time: "0800" }));
  it("09:41 -> 0900", () => expect(kmaBaseTime(kst(9, 41))).toEqual({ base_date: "20261104", base_time: "0900" }));
  it("00:20 -> 전날 2300", () => expect(kmaBaseTime(kst(0, 20))).toEqual({ base_date: "20261103", base_time: "2300" }));
});

describe("parseKmaNcst", () => {
  it("정상 응답", () => {
    expect(parseKmaNcst(kmaBody({ RN1: "2", PTY: "1" }))).toEqual({
      temp: 18.1,
      humidity: 65,
      wind_speed: 3.2,
      wind_dir: 45,
      rain_1h: 2,
      sky: "비",
    });
  });
  it("결측(-998.9)은 null", () => {
    const r = parseKmaNcst(kmaBody({ T1H: "-998.9", WSD: "-998.9", VEC: "999" }));
    expect(r.temp).toBeNull();
    expect(r.wind_speed).toBeNull();
    expect(r.wind_dir).toBeNull();
  });
  it("PTY -> 문구", () => {
    expect([0, 1, 2, 3, 5, 6, 7].map(ptyText)).toEqual(["강수 없음", "비", "비·눈", "눈", "빗방울", "빗방울·눈날림", "눈날림"]);
    expect(parseKmaNcst(kmaBody({ PTY: "0" })).sky).toBe("강수 없음");
    expect(parseKmaNcst(kmaBody({ PTY: "7" })).sky).toBe("눈날림");
  });
  it("resultCode가 00이 아니면 throw", () => {
    const b = kmaBody();
    b.response.header.resultCode = "03";
    expect(() => parseKmaNcst(b)).toThrow();
    expect(() => parseKmaNcst(forbidden)).toThrow();
  });
});

describe("fetchWeather 기상청 우선, Open-Meteo 대체", () => {
  it("기상청 성공: 같은 격자는 한 번만 부르고 source=기상청", async () => {
    process.env.KMA_AUTH_KEY = KEY;
    const grids = new Set(Object.values(AIR_SITES).map((s) => JSON.stringify(latLngToGrid(s.lat, s.lng))));
    const { f, urls, kmaCalls } = routed(() => json(kmaBody()));
    const r = await fetchWeather(f, () => NOW);
    expect(r.source).toBe("기상청");
    expect(r.updated_at).toBe("2026-11-04T09:00:00+09:00");
    expect(r.points).toHaveLength(N);
    expect(r.points[0]).toMatchObject({ site: "711", temp: 18.1, sky: "강수 없음", source: "기상청" });
    expect(kmaCalls()).toBe(grids.size);
    expect(kmaCalls()).toBeLessThanOrEqual(N);
    expect(urls.every((u) => u.includes("apihub.kma.go.kr"))).toBe(true);
    expect(urls[0]).toContain("base_date=20261104&base_time=0900");
  });
  it("403(활용신청 전)이면 Open-Meteo로 대체", async () => {
    process.env.KMA_AUTH_KEY = KEY;
    const { f } = routed(() => json(forbidden, 403));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await fetchWeather(f, () => NOW);
    expect(r.source).toBe("Open-Meteo");
    expect(r.points[0].source).toBe("Open-Meteo");
  });
  it("지점 하나라도 실패하면 기상청 전체를 버린다 (섞지 않음)", async () => {
    process.env.KMA_AUTH_KEY = KEY;
    let n = 0;
    const { f } = routed(() => (++n === 2 ? json({}, 500) : json(kmaBody())));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await fetchWeather(f, () => NOW);
    expect(r.source).toBe("Open-Meteo");
    expect(r.points.every((p) => p.source === "Open-Meteo")).toBe(true);
  });
  it("키가 없으면 기상청을 부르지 않는다", async () => {
    const { f, kmaCalls } = routed(() => json(kmaBody()));
    const r = await fetchWeather(f, () => NOW);
    expect(kmaCalls()).toBe(0);
    expect(r.source).toBe("Open-Meteo");
  });
  it("대체된 결과도 10분 캐시한다", async () => {
    process.env.KMA_AUTH_KEY = KEY;
    const { f, urls } = routed(() => json(forbidden, 403));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await fetchWeather(f, () => NOW);
    const n = urls.length;
    await fetchWeather(f, () => NOW + 5 * 60_000);
    expect(urls.length).toBe(n);
  });
  it("로그에 키와 URL이 들어가지 않는다", async () => {
    process.env.KMA_AUTH_KEY = KEY;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { f } = routed(() => json(forbidden, 403));
    await fetchWeather(f, () => NOW);
    expect(spy).toHaveBeenCalled();
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).not.toContain(KEY);
    expect(logged).not.toContain("apihub");
    expect(logged).not.toContain("authKey");
    expect(spy.mock.calls[0][0]).toBe("[weather] 기상청 실패, Open-Meteo로 대체");
    expect(spy.mock.calls[0][1]).toBe(403);
  });
  it("fetch가 키가 든 메시지로 throw해도 로그에는 에러 이름만", async () => {
    process.env.KMA_AUTH_KEY = KEY;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = (async (u: string) => {
      if (u.includes("apihub")) throw new TypeError(`failed ${u}`);
      return new Response(JSON.stringify(arrayBody()));
    }) as unknown as typeof fetch;
    const r = await fetchWeather(f, () => NOW);
    expect(r.source).toBe("Open-Meteo");
    expect(JSON.stringify(spy.mock.calls)).not.toContain(KEY);
  });
});
