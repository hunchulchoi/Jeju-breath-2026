import { beforeEach, describe, expect, it } from "vitest";
import {
  clearWeatherCache,
  fetchWeather,
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

beforeEach(() => clearWeatherCache());

describe("parseWeather", () => {
  it("배열 응답을 지점 순서대로 읽는다", () => {
    const r = parseWeather(arrayBody(), 0);
    expect(r.points).toHaveLength(N);
    expect(r.updated_at).toBe("2026-11-04T09:30:00+09:00");
    expect(r.points[0]).toMatchObject({ site: "711", name: "이도동", temp: 10, humidity: 70, wind_speed: 3.2, wind_dir: 45, weather_code: 3 });
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
