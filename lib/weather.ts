// 지도에 겹쳐 보여 주는 날씨. 기상청 초단기실황(KMA_AUTH_KEY 필요)을 먼저 쓰고,
// 키가 없거나 하나라도 실패하면 Open-Meteo(인증키 없음)로 통째로 대체한다. 출처를 섞지 않는다.
import { AIR_SITES } from "./air";
import type { WeatherPoint } from "./types";

const ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const TIMEOUT_MS = 5000;
const CACHE_MS = 10 * 60 * 1000;
const KMA_ENDPOINT = "https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0/getUltraSrtNcst";
export type WeatherSourceName = "기상청" | "Open-Meteo";
/** 화면에 보여 줄 출처 이름 */
export function sourceLabel(source: string): string {
  return source === "기상청" ? "기상청 초단기실황" : source;
}
/** 이보다 느리면 "바람 거의 없음" (m/s) */
export const CALM_WIND = 0.5;

export interface WeatherResult {
  source: WeatherSourceName;
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
      sky: weatherText(num(cur.weather_code)),
      rain_1h: null,
      source: "Open-Meteo",
    };
  });
  return { source: "Open-Meteo", updated_at: points[0].at, points };
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

// ---- 기상청 초단기실황 ----

/** 위경도 -> 기상청 격자 (Lambert Conformal Conic, 기상청 공식 변환식) */
export function latLngToGrid(lat: number, lng: number): { nx: number; ny: number } {
  const RE = 6371.00877 / 5.0; // 지구 반경 / 격자 간격
  const D2R = Math.PI / 180;
  const slat1 = 30 * D2R;
  const slat2 = 60 * D2R;
  const olon = 126 * D2R;
  const olat = 38 * D2R;
  let sn = Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + slat1 * 0.5);
  sf = (Math.pow(sf, sn) * Math.cos(slat1)) / sn;
  let ro = Math.tan(Math.PI * 0.25 + olat * 0.5);
  ro = (RE * sf) / Math.pow(ro, sn);
  let ra = Math.tan(Math.PI * 0.25 + lat * D2R * 0.5);
  ra = (RE * sf) / Math.pow(ra, sn);
  let theta = lng * D2R - olon;
  if (theta > Math.PI) theta -= 2 * Math.PI;
  if (theta < -Math.PI) theta += 2 * Math.PI;
  theta *= sn;
  return {
    nx: Math.floor(ra * Math.sin(theta) + 43 + 0.5),
    ny: Math.floor(ro - ra * Math.cos(theta) + 136 + 0.5),
  };
}

/** 초단기실황 기준 일시: 매시 정각 자료가 HH:40 이후 제공되므로 서울 시각에서 40분을 뺀 시각의 정시 */
export function kmaBaseTime(nowMs: number): { base_date: string; base_time: string } {
  const k = new Date(nowMs + 9 * 3600_000 - 40 * 60_000);
  const y = k.getUTCFullYear();
  const m = String(k.getUTCMonth() + 1).padStart(2, "0");
  const d = String(k.getUTCDate()).padStart(2, "0");
  const h = String(k.getUTCHours()).padStart(2, "0");
  return { base_date: `${y}${m}${d}`, base_time: `${h}00` };
}

/** PTY(강수형태) -> 표시 문구. 초단기실황에는 하늘(SKY)이 없다 */
export function ptyText(pty: number | null): string {
  switch (pty) {
    case 0:
      return "강수 없음";
    case 1:
      return "비";
    case 2:
      return "비·눈";
    case 3:
      return "눈";
    case 5:
      return "빗방울";
    case 6:
      return "빗방울·눈날림";
    case 7:
      return "눈날림";
    default:
      return "정보 없음";
  }
}

export interface KmaValues {
  temp: number | null;
  humidity: number | null;
  wind_speed: number | null;
  wind_dir: number | null;
  rain_1h: number | null;
  sky: string;
}

class KmaError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "KmaError";
  }
}

function kmaNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && Math.abs(n) < 900 ? n : null; // -998.9 같은 결측 코드
}

/** 격자 하나의 응답을 값으로. resultCode가 00이 아니거나 모양이 틀리면 throw */
export function parseKmaNcst(body: unknown): KmaValues {
  const resp = (body as { response?: { header?: { resultCode?: unknown }; body?: { items?: { item?: unknown } } } } | null)
    ?.response;
  if (resp?.header?.resultCode !== "00") throw new KmaError("kma: bad resultCode");
  const item = resp.body?.items?.item;
  if (!Array.isArray(item)) throw new KmaError("kma: no items");
  const by: Record<string, number | null> = {};
  for (const it of item as { category?: unknown; obsrValue?: unknown }[]) {
    if (typeof it?.category === "string") by[it.category] = kmaNum(it.obsrValue);
  }
  return {
    temp: by.T1H ?? null,
    humidity: by.REH ?? null,
    wind_speed: by.WSD ?? null,
    wind_dir: by.VEC ?? null,
    rain_1h: by.RN1 ?? null,
    sky: ptyText(by.PTY ?? null),
  };
}

function kmaUrl(key: string, base: { base_date: string; base_time: string }, g: { nx: number; ny: number }) {
  return (
    `${KMA_ENDPOINT}?pageNo=1&numOfRows=100&dataType=JSON&base_date=${base.base_date}&base_time=${base.base_time}` +
    `&nx=${g.nx}&ny=${g.ny}&authKey=${encodeURIComponent(key)}`
  );
}

/** 12개 지점의 격자를 구해 같은 격자는 한 번만 부른다. 하나라도 실패하면 throw */
export async function fetchKma(key: string, fetcher: typeof fetch, nowMs: number): Promise<WeatherResult> {
  const base = kmaBaseTime(nowMs);
  const grids = new Map<string, { nx: number; ny: number }>();
  const siteGrid = SITE_IDS.map((s) => {
    const g = latLngToGrid(AIR_SITES[s].lat, AIR_SITES[s].lng);
    const k = `${g.nx},${g.ny}`;
    grids.set(k, g);
    return k;
  });
  const entries = await Promise.all(
    [...grids.entries()].map(async ([k, g]) => {
      const res = await fetcher(kmaUrl(key, base, g), {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new KmaError("kma: http error", res.status);
      return [k, parseKmaNcst(await res.json())] as const;
    }),
  );
  const values = new Map(entries);
  const b = base.base_date;
  const at = `${b.slice(0, 4)}-${b.slice(4, 6)}-${b.slice(6, 8)}T${base.base_time.slice(0, 2)}:${base.base_time.slice(2)}:00+09:00`;
  const points: WeatherPoint[] = SITE_IDS.map((site, i) => {
    const info = AIR_SITES[site];
    return { site, name: info.name, lat: info.lat, lng: info.lng, at, ...values.get(siteGrid[i])!, source: "기상청" };
  });
  return { source: "기상청", updated_at: at, points };
}

async function fetchOpenMeteo(fetcher: typeof fetch, nowMs: number): Promise<WeatherResult> {
  const res = await fetcher(buildUrl(), {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`weather api http ${res.status}`);
  return parseWeather(await res.json(), nowMs);
}

const g = globalThis as unknown as { __jejuWeatherCache?: { at: number; value: WeatherResult } };

export function clearWeatherCache() {
  delete g.__jejuWeatherCache;
}

/**
 * 모든 지점의 현재 날씨. KMA_AUTH_KEY가 있으면 기상청을 먼저, 실패하면 Open-Meteo.
 * 최종 결과를 10분 메모리 캐시한다. 둘 다 실패하면 throw.
 */
export async function fetchWeather(
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<WeatherResult> {
  const hit = g.__jejuWeatherCache;
  if (hit && now() - hit.at < CACHE_MS) return hit.value;
  const key = process.env.KMA_AUTH_KEY?.trim();
  let value: WeatherResult | null = null;
  if (key) {
    try {
      value = await fetchKma(key, fetcher, now());
    } catch (e) {
      // 키와 URL은 로그에 남기지 않는다 (상태 코드나 에러 이름만)
      const why = e instanceof KmaError && e.status ? e.status : e instanceof Error ? e.name : "unknown";
      console.error("[weather] 기상청 실패, Open-Meteo로 대체", why);
    }
  }
  value ??= await fetchOpenMeteo(fetcher, now());
  g.__jejuWeatherCache = { at: now(), value };
  return value;
}
