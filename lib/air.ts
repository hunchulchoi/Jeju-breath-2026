// 제주 대기환경 정보 OpenAPI (제주특별자치도 보건환경연구원, 인증키 없음, XML)
import type { AirStation } from "./types";

const ENDPOINT = "https://air.jeju.go.kr/rest/JejuAirService/getJejuAirList/";
const TIMEOUT_MS = 5000;
const CACHE_MS = 10 * 60 * 1000;
const CACHE_MAX = 20;

/**
 * API가 좌표를 주지 않는다. 보건환경연구원 측정소 정보(주소)를 지오코딩한 값이다.
 * approx: 주소가 지번이라 위치를 정확히 찾지 못한 곳 (읍·동·리 중심 근사값).
 */
export const AIR_SITES: Record<string, { name: string; lat: number; lng: number; approx: boolean }> = {
  "711": { name: "이도동", lat: 33.50034, lng: 126.53268, approx: false }, // 제주시청
  "712": { name: "연동", lat: 33.48922, lng: 126.50039, approx: false }, // 도청 제2청사
  "713": { name: "한림읍", lat: 33.41003, lng: 126.26806, approx: false }, // 한림종합운동장
  "714": { name: "조천읍", lat: 33.53947, lng: 126.64366, approx: false }, // 조천체육관
  "715": { name: "화북동", lat: 33.5151, lng: 126.5528, approx: true }, // 화북일동 1098
  "716": { name: "애월", lat: 33.46315, lng: 126.3389, approx: true }, // 애월읍 고내리 1319 애월근린공원 옆 (고내리 근사값)
  "721": { name: "동홍동", lat: 33.24643, lng: 126.56518, approx: false }, // 서귀포기상대
  "722": { name: "성산", lat: 33.46756, lng: 126.91329, approx: true }, // 성산읍 오조리 (동부소방서)
  "723": { name: "대정", lat: 33.219, lng: 126.251, approx: true }, // 대정읍 하모리
  "724": { name: "남원", lat: 33.279, lng: 126.719, approx: true }, // 남원읍
  "725": { name: "강정동", lat: 33.235, lng: 126.48, approx: true }, // 강정동
  "801": { name: "노형동", lat: 33.484, lng: 126.477, approx: true }, // 노형동 (도로변)
};

export type AirRow = Record<string, string | null>;

function clean(v: string | undefined): string | null {
  const s = (v ?? "").trim();
  return s === "" || s === "null" || s === "X" ? null : s;
}

/** 응답 XML을 <list> 단위 행 배열로 바꾼다. resultCode가 00이 아니면 throw */
export function parseJejuAirXml(xml: string): AirRow[] {
  const code = /<resultCode>\s*([^<]*?)\s*<\/resultCode>/.exec(xml)?.[1];
  if (code !== "00") throw new Error(`air api error: ${code ?? "no resultCode"}`);
  const rows: AirRow[] = [];
  for (const m of xml.matchAll(/<list>([\s\S]*?)<\/list>/g)) {
    const row: AirRow = {};
    for (const t of m[1].matchAll(/<([A-Za-z0-9_]+)>([^<]*)<\/\1>/g)) row[t[1]] = clean(t[2]);
    rows.push(row);
  }
  return rows;
}

function num(v: string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cai(v: string | null | undefined): 1 | 2 | 3 | 4 | null {
  const n = num(v);
  return n === 1 || n === 2 || n === 3 || n === 4 ? n : null;
}

/** 2026110321 -> 2026-11-03T21:00:00+09:00 (형식이 틀리면 null) */
function measuredAt(dt10: string | null | undefined): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})$/.exec(dt10 ?? "");
  if (!m || Number(m[4]) > 23) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:00:00+09:00`;
}

/** 측정소별 가장 최근 시각 한 건. 모르는 SITE는 버린다 */
export function latestBySite(rows: AirRow[]): AirStation[] {
  const best = new Map<string, { at: string; row: AirRow }>();
  for (const row of rows) {
    const site = row.SITE ?? "";
    const at = measuredAt(row.DT10);
    if (!AIR_SITES[site] || !at) continue;
    const cur = best.get(site);
    if (!cur || at > cur.at) best.set(site, { at, row });
  }
  const out: AirStation[] = [];
  for (const [site, { at, row }] of best) {
    const info = AIR_SITES[site];
    // 통합대기지수는 항목별 등급 중 가장 나쁜 값이다. 대표 등급이 비었으면 측정된 모든 항목의 최댓값으로 대신한다.
    const subCais = [row.PM10_CAI, row.PM25_CAI, row.O3_CAI, row.NO2_CAI, row.CO_CAI, row.SO2_CAI]
      .map(cai)
      .filter((c): c is 1 | 2 | 3 | 4 => c !== null);
    out.push({
      site,
      name: info.name,
      lat: info.lat,
      lng: info.lng,
      approx: info.approx,
      measured_at: at,
      cai: cai(row.REP_CAI) ?? (subCais.length ? (Math.max(...subCais) as 1 | 2 | 3 | 4) : null),
      rep_item: row.REP_ITEM ?? null,
      pm10: num(row.PM10),
      pm25: num(row.PM25),
      o3: num(row.O3),
    });
  }
  return out.sort((a, b) => a.site.localeCompare(b.site));
}

interface CacheEntry {
  at: number;
  stations: AirStation[];
}
const g = globalThis as unknown as { __jejuAirCache?: Map<string, CacheEntry> };
const cache = () => (g.__jejuAirCache ??= new Map());

export function clearAirCache() {
  cache().clear();
}

/** 그날 모든 측정소의 최신 값. 날짜별 10분 메모리 캐시, 5초 타임아웃, 실패하면 throw */
export async function fetchJejuAir(
  day: string,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<AirStation[]> {
  const c = cache();
  const hit = c.get(day);
  if (hit && now() - hit.at < CACHE_MS) return hit.stations;
  const res = await fetcher(`${ENDPOINT}?date=${day.replaceAll("-", "")}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: "application/xml" },
  });
  if (!res.ok) throw new Error(`air api http ${res.status}`);
  const stations = latestBySite(parseJejuAirXml(await res.text()));
  if (c.size >= CACHE_MAX) c.delete(c.keys().next().value!);
  c.set(day, { at: now(), stations });
  return stations;
}

export const AIR_SOURCE = "제주특별자치도 보건환경연구원";
