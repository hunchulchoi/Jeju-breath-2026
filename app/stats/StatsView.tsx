"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { TopBar } from "../components/TopBar";
import type { Stats } from "@/lib/stats";
import { INTENSITY_COLORS, INTENSITY_LABELS } from "@/lib/types";

const PERIODS = [
  { days: 1, label: "오늘" },
  { days: 7, label: "최근 7일" },
  { days: 30, label: "최근 30일" },
] as const;

const NEUTRAL = "#475569";
const EMPTY = "이 기간에는 제보가 없어요.";

const dayLabel = (d: string) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`;
const shortDay = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const pct = (v: number | null) => (v === null ? "-" : `${Math.round(v * 100)}%`);

export default function StatsView({ initial }: { initial: Stats }) {
  const [days, setDays] = useState<number>(initial.range.days);
  const [stats, setStats] = useState<Stats>(initial);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);

  async function choose(next: number) {
    // 같은 기간이라도 직전 요청이 실패했으면 다시 시도할 수 있게 한다 (Codex 리뷰)
    if (next === days && !failed && stats.range.days === next) return;
    setDays(next);
    setFailed(false);
    setLoading(true);
    const mine = ++seq.current;
    try {
      const r = await fetch(`/api/stats?days=${next}`, { cache: "no-store" });
      if (!r.ok) throw new Error();
      const data = (await r.json()) as Stats;
      if (mine === seq.current) setStats(data);
    } catch {
      if (mine === seq.current) setFailed(true);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }

  const t = stats.totals;
  const empty = t.reports === 0;
  const rangeText =
    stats.range.days === 1
      ? dayLabel(stats.range.to)
      : `${dayLabel(stats.range.from)} ~ ${dayLabel(stats.range.to)}`;

  return (
    <main className="container">
      <TopBar badges={t.has_demo ? <span className="badge">시연 모드: 가상 데이터</span> : null} />
      <h1>악취 제보 통계 (제보 기준)</h1>
      <p className="muted small">주민이 보낸 제보를 모아 센 숫자예요. 제보가 없다고 악취가 없었다는 뜻은 아니에요.</p>

      <div className="seg" role="group" aria-label="기간 선택">
        {PERIODS.map((p) => (
          <button key={p.days} type="button" className="seg-btn" aria-pressed={days === p.days} onClick={() => choose(p.days)}>
            {p.label}
          </button>
        ))}
      </div>
      <p className="muted small" aria-live="polite" aria-busy={loading} style={{ margin: "8px 0 12px" }}>
        {failed ? "통계를 불러오지 못했어요. 잠시 뒤 다시 눌러 주세요." : loading ? "불러오는 중이에요" : `${rangeText} 기준`}
      </p>

      <div className="tiles" style={{ opacity: loading ? 0.6 : 1 }}>
        <Tile n={t.reports} unit="건" label="제보" />
        <Tile n={t.high} unit="건" label="강도 4 이상" />
        <Tile n={t.merged_extra} unit="건" label="같은 곳 다시 제보(합쳐짐)" />
        <Tile n={t.location_failures} unit="회" label="위치 실패(저장 안 함)" />
      </div>
      {t.review > 0 ? (
        <p className="muted small">확인이 필요한 제보 {t.review}건은 아래 숫자와 그래프에서 뺐어요.</p>
      ) : null}

      <div className="stack" style={{ marginTop: 16, opacity: loading ? 0.6 : 1 }}>
        {stats.range.days > 1 ? <DayChart stats={stats} empty={empty} /> : null}
        <HourChart stats={stats} empty={empty} />
        <IntensityChart stats={stats} empty={empty} />
        <OdorChart stats={stats} empty={empty} />
        <FunnelChart stats={stats} />
      </div>

      <div className="stack" style={{ marginTop: 20 }}>
        <Link href="/map" className="btn secondary">
          오늘 지도 보기
        </Link>
      </div>
      <p className="muted small" style={{ marginTop: 16 }}>
        이 숫자는 주민 제보 기준이며 원인이나 책임을 판단하지 않아요.
      </p>
    </main>
  );
}

function Tile({ n, unit, label }: { n: number; unit: string; label: string }) {
  return (
    <div className="tile">
      <div className="tile-n">
        {n}
        <span className="tile-unit">{unit}</span>
      </div>
      <div className="tile-label">{label}</div>
    </div>
  );
}

function ChartCard({ title, children, table }: { title: string; children: React.ReactNode; table: React.ReactNode }) {
  return (
    <section className="card chart-card">
      <h2>{title}</h2>
      {children}
      <details className="chart-table">
        <summary>표로 보기</summary>
        {table}
      </details>
    </section>
  );
}

/* ---------- 세로 막대 (SVG) ---------- */

interface Seg {
  v: number;
  color: string;
  /** 이 조각에 올렸을 때 툴팁 */
  text: string;
}
interface Col {
  xLabel: string | null;
  segs: Seg[];
  /** 칸 전체(히트 영역) 툴팁 줄들 */
  tip: string[];
  aria: string;
}
interface Tip {
  x: number;
  y: number;
  lines: string[];
}

const W = 320;
const PAD = { l: 30, r: 6, t: 20, b: 22 };

/** 정수 눈금: 0부터 max를 덮는 최대 5개 */
function niceTicks(max: number): number[] {
  const step = Math.max(1, Math.ceil(max / 4));
  const ticks: number[] = [];
  for (let v = 0; v < max + step; v += step) {
    ticks.push(v);
    if (v >= max) break;
  }
  return ticks;
}

function topRounded(x: number, y0: number, y1: number, w: number, round: boolean) {
  const r = round ? Math.min(4, w / 2, y1 - y0) : 0;
  return `M${x},${y1}L${x},${y0 + r}Q${x},${y0} ${x + r},${y0}L${x + w - r},${y0}Q${x + w},${y0} ${x + w},${y0 + r}L${x + w},${y1}Z`;
}

function ColumnChart({
  cols,
  height = 170,
  annotate,
  label,
}: {
  cols: Col[];
  height?: number;
  annotate?: (i: number) => string | null;
  label: string;
}) {
  const [tip, setTip] = useState<Tip | null>(null);
  const totals = cols.map((c) => c.segs.reduce((s, g) => s + g.v, 0));
  const max = Math.max(...totals, 1);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const H = height;
  const plotH = H - PAD.t - PAD.b;
  const y = (v: number) => PAD.t + plotH - (v / top) * plotH;
  const slot = (W - PAD.l - PAD.r) / cols.length;
  const barW = Math.max(3, slot - 2);
  const base = PAD.t + plotH;

  return (
    <div className="vchart" onMouseLeave={() => setTip(null)} onKeyDown={(e) => e.key === "Escape" && setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="group" aria-label={label} style={{ display: "block" }}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
            <text x={PAD.l - 5} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--muted)">
              {v}
            </text>
          </g>
        ))}
        {cols.map((c, i) => {
          const x = PAD.l + i * slot + (slot - barW) / 2;
          const cx = x + barW / 2;
          const nonzero = c.segs.map((g, k) => ({ g, k })).filter(({ g }) => g.v > 0);
          let acc = 0;
          const topIdx = nonzero.length - 1;
          return (
            <g key={i}>
              {nonzero.map(({ g }, j) => {
                const yb = y(acc);
                acc += g.v;
                const yt = y(acc);
                const y1 = j > 0 ? yb - 1 : yb;
                const yy0 = Math.min(j < topIdx ? yt + 1 : yt, y1 - 2);
                return (
                  <path
                    key={j}
                    d={topRounded(x, yy0, y1, barW, j === topIdx)}
                    fill={g.color}
                    onMouseEnter={() => setTip({ x: cx, y: yy0, lines: [g.text] })}
                  />
                );
              })}
              <rect
                className="hit"
                x={PAD.l + i * slot}
                y={PAD.t}
                width={slot}
                height={plotH}
                fill="transparent"
                tabIndex={0}
                role="img"
                aria-label={c.aria}
                onMouseEnter={() => setTip({ x: cx, y: y(totals[i]), lines: c.tip })}
                onFocus={() => setTip({ x: cx, y: y(totals[i]), lines: c.tip })}
                onBlur={() => setTip(null)}
                onClick={() => setTip({ x: cx, y: y(totals[i]), lines: c.tip })}
              />
              {c.xLabel ? (
                <text x={cx} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--muted)">
                  {c.xLabel}
                </text>
              ) : null}
            </g>
          );
        })}
        <line x1={PAD.l} x2={W - PAD.r} y1={base} y2={base} stroke="var(--muted)" strokeWidth={1} />
        {annotate
          ? cols.map((_, i) => {
              const text = annotate(i);
              if (!text) return null;
              const cx = PAD.l + i * slot + slot / 2;
              const anchor = cx < PAD.l + 40 ? "start" : cx > W - 50 ? "end" : "middle";
              const ax = anchor === "start" ? cx - slot / 2 : anchor === "end" ? cx + slot / 2 : cx;
              return (
                <text key={i} x={ax} y={y(totals[i]) - 5} textAnchor={anchor} fontSize={12} fontWeight={700} fill="var(--ink)">
                  {text}
                </text>
              );
            })
          : null}
      </svg>
      {tip ? (
        <div
          className="tip"
          role="tooltip"
          style={{
            left: `${Math.min(85, Math.max(15, (tip.x / W) * 100))}%`,
            top: `${(tip.y / H) * 100}%`,
          }}
        >
          {tip.lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DayChart({ stats, empty }: { stats: Stats; empty: boolean }) {
  const n = stats.by_day.length;
  const cols: Col[] = stats.by_day.map((d, i) => {
    const total = [1, 2, 3, 4, 5].reduce((s, k) => s + d.counts[k], 0);
    const nz = [1, 2, 3, 4, 5].filter((k) => d.counts[k] > 0);
    return {
      xLabel: n <= 7 || (n - 1 - i) % 5 === 0 ? shortDay(d.date) : null,
      segs: [1, 2, 3, 4, 5].map((k) => ({
        v: d.counts[k],
        color: INTENSITY_COLORS[k],
        text: `${dayLabel(d.date)} · 강도 ${k} · ${d.counts[k]}건`,
      })),
      tip: [`${dayLabel(d.date)} · 제보 ${total}건`, ...nz.map((k) => `강도 ${k} · ${d.counts[k]}건`)],
      aria: `${dayLabel(d.date)} · 제보 ${total}건${nz.length ? ` (${nz.map((k) => `강도 ${k} ${d.counts[k]}건`).join(", ")})` : ""}`,
    };
  });
  return (
    <ChartCard
      title="날짜별 제보"
      table={
        <table>
          <caption className="visually-hidden">날짜별 제보 건수</caption>
          <thead>
            <tr>
              <th scope="col">날짜</th>
              {[1, 2, 3, 4, 5].map((k) => (
                <th key={k} scope="col">
                  강도 {k}
                </th>
              ))}
              <th scope="col">합계</th>
            </tr>
          </thead>
          <tbody>
            {stats.by_day.map((d) => (
              <tr key={d.date}>
                <th scope="row">{dayLabel(d.date)}</th>
                {[1, 2, 3, 4, 5].map((k) => (
                  <td key={k}>{d.counts[k]}</td>
                ))}
                <td>{[1, 2, 3, 4, 5].reduce((s, k) => s + d.counts[k], 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      {empty ? (
        <p className="muted">{EMPTY}</p>
      ) : (
        <>
          <ColumnChart cols={cols} label="날짜별 제보 건수, 강도별로 쌓은 막대" />
          <ul className="chart-legend" aria-label="강도 범례">
            {[1, 2, 3, 4, 5].map((k) => (
              <li key={k}>
                <span className="swatch" style={{ background: INTENSITY_COLORS[k] }} aria-hidden="true" />
                {k} {INTENSITY_LABELS[k].short}
              </li>
            ))}
          </ul>
        </>
      )}
    </ChartCard>
  );
}

function HourChart({ stats, empty }: { stats: Stats; empty: boolean }) {
  const hours = stats.by_hour;
  const maxCount = Math.max(...hours.map((h) => h.count));
  const maxIdx = hours.findIndex((h) => h.count === maxCount);
  const cols: Col[] = hours.map((h) => {
    const text = `${h.hour}시 · ${h.count}건`;
    return {
      xLabel: [0, 6, 12, 18, 23].includes(h.hour) ? `${h.hour}시` : null,
      segs: [{ v: h.count, color: "var(--brand)", text }],
      tip: [text],
      aria: text,
    };
  });
  return (
    <ChartCard
      title="시간대별 제보"
      table={
        <table>
          <caption className="visually-hidden">시간대별 제보 건수</caption>
          <thead>
            <tr>
              <th scope="col">시간대</th>
              <th scope="col">제보</th>
            </tr>
          </thead>
          <tbody>
            {hours.map((h) => (
              <tr key={h.hour}>
                <th scope="row">{h.hour}시</th>
                <td>{h.count}건</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      {empty ? (
        <p className="muted">{EMPTY}</p>
      ) : (
        <ColumnChart
          cols={cols}
          label="시간대별 제보 건수"
          annotate={(i) => (i === maxIdx ? `${hours[i].hour}시 ${hours[i].count}건` : null)}
        />
      )}
    </ChartCard>
  );
}

/* ---------- 가로 막대 (CSS) ---------- */

interface Row {
  key: string;
  label: string;
  value: number;
  color: string;
  tip: string;
  display: string;
}

function HBars({ rows, max, labelWidth }: { rows: Row[]; max: number; labelWidth: string }) {
  const [active, setActive] = useState<string | null>(null);
  return (
    <div className="hbars" onMouseLeave={() => setActive(null)} onKeyDown={(e) => e.key === "Escape" && setActive(null)}>
      {rows.map((r) => (
        <div
          key={r.key}
          className="hrow"
          tabIndex={0}
          role="img"
          aria-label={r.tip}
          onMouseEnter={() => setActive(r.key)}
          onFocus={() => setActive(r.key)}
          onBlur={() => setActive(null)}
          onClick={() => setActive(r.key)}
        >
          <span className="hlabel" style={{ width: labelWidth }}>
            {r.label}
          </span>
          <span className="htrack">
            {r.value > 0 ? (
              <span className="hbar" style={{ width: `${(r.value / Math.max(max, 1)) * 100}%`, background: r.color }} />
            ) : null}
            {active === r.key ? (
              <span className="tip tip-h" role="tooltip">
                {r.tip}
              </span>
            ) : null}
          </span>
          <span className="hval">{r.display}</span>
        </div>
      ))}
    </div>
  );
}

function IntensityChart({ stats, empty }: { stats: Stats; empty: boolean }) {
  const rows: Row[] = [...stats.by_intensity].reverse().map((i) => ({
    key: String(i.intensity),
    label: `${i.intensity} ${INTENSITY_LABELS[i.intensity].short}`,
    value: i.count,
    color: INTENSITY_COLORS[i.intensity],
    tip: `강도 ${i.intensity} · ${i.count}건`,
    display: `${i.count}건`,
  }));
  return (
    <ChartCard
      title="강도별 제보"
      table={
        <table>
          <caption className="visually-hidden">강도별 제보 건수</caption>
          <thead>
            <tr>
              <th scope="col">강도</th>
              <th scope="col">제보</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row">{r.label}</th>
                <td>{r.display}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      {empty ? <p className="muted">{EMPTY}</p> : <HBars rows={rows} max={Math.max(...rows.map((r) => r.value))} labelWidth="8.6em" />}
    </ChartCard>
  );
}

function OdorChart({ stats, empty }: { stats: Stats; empty: boolean }) {
  const rows: Row[] = stats.by_odor.map((o) => ({
    key: o.odor_type,
    label: o.label,
    value: o.count,
    color: NEUTRAL,
    tip: `${o.label} · ${o.count}건`,
    display: `${o.count}건`,
  }));
  return (
    <ChartCard
      title="냄새 종류"
      table={
        <table>
          <caption className="visually-hidden">냄새 종류별 제보 건수</caption>
          <thead>
            <tr>
              <th scope="col">냄새 종류</th>
              <th scope="col">제보</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row">{r.label}</th>
                <td>{r.display}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      {empty || !rows.length ? <p className="muted">{EMPTY}</p> : <HBars rows={rows} max={rows[0].value} labelWidth="8.6em" />}
    </ChartCard>
  );
}

function FunnelChart({ stats }: { stats: Stats }) {
  const f = stats.funnel;
  const rows: Row[] = [
    { key: "started", label: "시작", value: f.started },
    { key: "saved", label: "저장", value: f.saved },
    { key: "map", label: "지도 열람", value: f.map_viewed },
  ].map((r) => ({ ...r, color: NEUTRAL, tip: `${r.label} · ${r.value}회`, display: `${r.value}회` }));
  const none = f.started + f.saved + f.map_viewed === 0;
  return (
    <ChartCard
      title="참여 지표"
      table={
        <table>
          <caption className="visually-hidden">참여 지표</caption>
          <thead>
            <tr>
              <th scope="col">항목</th>
              <th scope="col">값</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row">{r.label}</th>
                <td>{r.display}</td>
              </tr>
            ))}
            <tr>
              <th scope="row">완료율</th>
              <td>{pct(f.completion_rate)}</td>
            </tr>
            <tr>
              <th scope="row">위치 허용률</th>
              <td>{pct(f.gps_allow_rate)}</td>
            </tr>
            <tr>
              <th scope="row">지도 열람률</th>
              <td>{pct(f.map_view_rate)}</td>
            </tr>
          </tbody>
        </table>
      }
    >
      {none ? (
        <p className="muted">{EMPTY}</p>
      ) : (
        <HBars rows={rows} max={Math.max(...rows.map((r) => r.value))} labelWidth="5.6em" />
      )}
      <dl className="rates">
        <div>
          <dt>완료율</dt>
          <dd>{pct(f.completion_rate)}</dd>
        </div>
        <div>
          <dt>위치 허용률</dt>
          <dd>{pct(f.gps_allow_rate)}</dd>
        </div>
        <div>
          <dt>지도 열람률</dt>
          <dd>{pct(f.map_view_rate)}</dd>
        </div>
      </dl>
      <p className="muted small" style={{ margin: 0, fontSize: 14 }}>
        완료율 = 저장 ÷ 시작 · 위치 허용률 = 1 − 위치 실패 ÷ 시작 · 지도 열람률 = 지도 열람 ÷ 저장
      </p>
    </ChartCard>
  );
}
