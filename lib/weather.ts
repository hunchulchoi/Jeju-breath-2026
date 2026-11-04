// 지도에 겹쳐 보여 주는 날씨 (Open-Meteo, 인증키 없음). 출처를 바꾸려면 이 파일만 고친다.
import { AIR_SITES } from "./air";
import type { WeatherPoint } from "./types";

const ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const TIMEOUT_MS = 5000;
const CACHE_MS = 10 * 60 * 1000;
export const WEATHER_SOURCE = "Open-Meteo";
/** 이보다 느리면 "바람 거의 없음" (m/s) */
export const CALM_WIND = 0.5;

export interface WeatherResult {
  updated_at: string;
  points: WeatherPoint[];
}

const DIRS = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"];

/** 방위 이름 (8방위, "풍" 없이): 북, 북동 ... */
export function windDirName(deg: number): string {
  const d = ((deg % 360) + 360) % 360;
  return DIRS[Math.floor((d + 22.5) / 45) % 8];
}

/** 바람이 불어오는 쪽 이름: "북동풍" */
export function windFromLabel(deg: number): string {
  return `${windDirName(deg)}풍`;
}

/** 화살표가 가리킬 방향 = 바람이 불어 가는 쪽 = 냄새가 퍼질 수 있는 쪽 */
export function windToDeg(deg: number): number {
  return (((deg + 180) % 360) + 360) % 360;
}

/** WMO 날씨 코드를 쉬운 말로 */
export function weatherText(code: number | null): string {
  if (code === null) return "정보 없음";
  if (code === 0) return "맑음";
  if (code <= 2) return "구름 조금";
  if (code === 3) return "흐림";
  if (code === 45 || code === 48) return "안개";
  if (code >= 51 && code <= 57) return "이슬비";
  if ((code >= 61 && code <= 67)) return "비";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "눈";
  if (code >= 80 && code <= 82) return "소나기";
  if (code >= 95 && code <= 99) return "뇌우";
  return "정보 없음";
}

export function isCalm(speed: number | null): boolean {
  return speed !== null && speed < CALM_WIND;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** "2026-11-04T09:30" (Asia/Seoul) -> "2026-11-04T09:30:00+09:00" */
function kstIso(time: unknown, fallbackMs: number): string {
  if (typeof time === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(time)) return `${time}:00+09:00`;
  const k = new Date(fallbackMs + 9 * 3600_000).toISOString();
  return `${k.slice(0, 16)}:00+09:00`;
}

const SITE_IDS = Object.keys(AIR_SITES);

/** 응답(지점 여러 개면 배열, 하나면 객체)을 지점별 값으로 바꾼다. 모양이 틀리면 throw */
export function parseWeather(body: unknown, nowMs: number, sites: string[] = SITE_IDS): WeatherResult {
  const items = Array.isArray(body) ? body : [body];
  if (items.length !== sites.length) throw new Error("weather api: unexpected result count");
  const points: WeatherPoint[] = items.map((raw, i) => {
    const cur = (raw as { current?: Record<string, unknown> } | null)?.current;
    if (!cur || typeof cur !== "object") throw new Error("weather api: no current");
    const site = sites[i];
    const info = AIR_SITES[site];
    return {
      site,
      name: info.name,
      lat: info.lat,
      lng: info.lng,
      at: kstIso(cur.time, nowMs),
      temp: num(cur.temperature_2m),
      humidity: num(cur.relative_humidity_2m),
      wind_speed: num(cur.wind_speed_10m),
      wind_dir: num(cur.wind_direction_10m),
      weather_code: num(cur.weather_code),
    };
  });
  return { updated_at: points[0].at, points };
}

function buildUrl() {
  const lat = SITE_IDS.map((s) => AIR_SITES[s].lat).join(",");
  const lng = SITE_IDS.map((s) => AIR_SITES[s].lng).join(",");
  return (
    `${ENDPOINT}?latitude=${lat}&longitude=${lng}` +
    "&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code" +
    "&wind_speed_unit=ms&timezone=Asia%2FSeoul"
  );
}

const g = globalThis as unknown as { __jejuWeatherCache?: { at: number; value: WeatherResult } };

export function clearWeatherCache() {
  delete g.__jejuWeatherCache;
}

/** 모든 지점의 현재 날씨. 10분 메모리 캐시, 5초 타임아웃, 실패하면 throw */
export async function fetchWeather(
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<WeatherResult> {
  const hit = g.__jejuWeatherCache;
  if (hit && now() - hit.at < CACHE_MS) return hit.value;
  const res = await fetcher(buildUrl(), {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`weather api http ${res.status}`);
  const value = parseWeather(await res.json(), now());
  g.__jejuWeatherCache = { at: now(), value };
  return value;
}
