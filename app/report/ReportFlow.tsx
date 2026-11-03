"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { TopBar } from "../components/TopBar";
import { formatTime } from "@/lib/time";
import { INTENSITY_COLORS, INTENSITY_LABELS, type OdorType } from "@/lib/types";

const MAX_LEN = 500;
const EXAMPLES = ["축사 냄새 때문에 창문을 못 열겠어요", "냄새가 납니다", "돼지 냄새 때문에 숨 막혀요"];
// 시연 모드 테스트 좌표 (애월읍)
const DEMO_COORDS = { lat: 33.4262, lng: 126.3361, accuracy: 15 };
const SAFETY_TEXT =
  "이 정보는 주민 제보 기준이며 원인이나 책임을 판단하지 않아요. 건강 이상이 있으면 119 또는 의료기관에 문의하세요.";

type Step = "input" | "location" | "processing" | "confirm" | "saving" | "done" | "error";

interface Extracted {
  intensity: number | null;
  odor_type: OdorType;
  symptoms: string[];
  confidence: number;
  needs_question: boolean;
  ai: boolean;
}

interface Coords {
  lat: number;
  lng: number;
  accuracy: number;
}

interface Saved {
  id: number;
  merged: boolean;
  needs_review: boolean;
  today_nearby_count: number;
  reported_at: string;
  intensity: number;
  odor_type: OdorType;
}

function getUserId(): string {
  const make = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try {
    const saved = localStorage.getItem("jbb_user_id");
    if (saved) return saved;
    const id = make();
    localStorage.setItem("jbb_user_id", id);
    return id;
  } catch {
    return make();
  }
}

function postEvent(name: "report_started") {
  fetch("/api/events", { method: "POST", body: JSON.stringify({ name }) }).catch(() => {});
}

function postLocationFailure() {
  fetch("/api/location-failures", { method: "POST" }).catch(() => {});
}

function getPosition(): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("unsupported"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(e),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  });
}

export default function ReportFlow({ demoMode }: { demoMode: boolean }) {
  const [step, setStep] = useState<Step>("input");
  const [text, setText] = useState("");
  const [inputError, setInputError] = useState("");
  const [useDemoCoords, setUseDemoCoords] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [extracted, setExtracted] = useState<Extracted | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // 단계가 바뀌면 화면 읽기 프로그램이 새 안내를 읽도록 제목으로 초점을 옮긴다
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  function send(value = text) {
    const trimmed = value.trim();
    if (!trimmed) return setInputError("냄새를 한 문장으로 적어 주세요.");
    if (trimmed.length > MAX_LEN) return setInputError(`${MAX_LEN}자 이내로 적어 주세요.`);
    setText(trimmed);
    setInputError("");
    postEvent("report_started");
    setStep("location");
  }

  async function requestLocation() {
    setBusy(true);
    let position: Coords;
    try {
      position = useDemoCoords ? DEMO_COORDS : await getPosition();
    } catch {
      postLocationFailure();
      setErrorMessage("위치를 확인하지 못해 저장하지 않았어요.");
      setStep("error");
      setBusy(false);
      return;
    }
    setBusy(false);
    setCoords(position);
    setStep("processing");
    let result: Extracted;
    try {
      const res = await fetch("/api/reports/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error();
      result = await res.json();
    } catch {
      result = { intensity: null, odor_type: "알 수 없음", symptoms: [], confidence: 0, needs_question: true, ai: false };
    }
    setExtracted(result);
    if (result.needs_question || result.intensity === null) {
      setStep("confirm");
    } else {
      await save(position, result, result.intensity, "ai");
    }
  }

  async function save(position: Coords, ex: Extracted, intensity: number, src: "ai" | "button") {
    setStep("saving");
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: getUserId(),
          text,
          lat: position.lat,
          lng: position.lng,
          accuracy: position.accuracy,
          intensity,
          intensity_src: src,
          odor_type: ex.odor_type,
          symptoms: ex.symptoms,
          confidence: src === "ai" ? ex.confidence : null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 422) {
        // 서버가 위치를 거절함 (제주 밖·정확도 부족). 실패 횟수는 서버가 셌다.
        setErrorMessage(body.error ?? "위치를 확인하지 못해 저장하지 않았어요.");
        setStep("error");
        return;
      }
      if (!res.ok) throw new Error(body.error);
      setSaved({ ...body, intensity, odor_type: ex.odor_type });
      setStep("done");
    } catch {
      setErrorMessage("저장 중 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.");
      setStep("error");
    }
  }

  function chooseIntensity(n: number) {
    if (!coords || !extracted) return;
    void save(coords, extracted, n, "button");
  }

  function retry() {
    setShowHelp(false);
    setStep("location");
  }

  function restart() {
    setText("");
    setCoords(null);
    setExtracted(null);
    setSaved(null);
    setShowHelp(false);
    setStep("input");
  }

  return (
    <main className="container">
      <TopBar badges={demoMode && useDemoCoords ? <span className="badge">시연 모드: 테스트 좌표</span> : null} />

      {/* 대화 기록 */}
      <div className="chat" aria-live="polite">
        <div className="bubble bot">지금 느끼는 냄새를 한 문장으로 보내 주세요</div>
        {step !== "input" && text ? <div className="bubble user">{text}</div> : null}
        {extracted && extracted.ai && extracted.intensity !== null && !extracted.needs_question ? (
          <div className="bubble bot result">{resultCard(extracted.intensity, extracted.odor_type, extracted.symptoms)}</div>
        ) : null}
        {step === "done" && saved && extracted?.needs_question ? (
          <div className="bubble user">
            {saved.intensity} {INTENSITY_LABELS[saved.intensity].short}
          </div>
        ) : null}
      </div>

      {step === "input" ? (
        <section className="stack" aria-labelledby="step-title">
          <h1 id="step-title" ref={headingRef} tabIndex={-1}>
            지금 느끼는 냄새를 한 문장으로 보내 주세요
          </h1>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <label htmlFor="report-text" className="visually-hidden">
              제보 문장
            </label>
            <textarea
              id="report-text"
              value={text}
              maxLength={MAX_LEN + 50}
              placeholder="예: 축사 냄새 때문에 창문을 못 열겠어요"
              onChange={(e) => setText(e.target.value)}
              aria-invalid={inputError ? true : undefined}
              aria-describedby="text-counter text-error"
            />
            <div id="text-counter" className={`counter ${text.length > MAX_LEN ? "form-error" : "muted"}`}>
              {text.length}/{MAX_LEN}자
            </div>
            {inputError ? (
              <p id="text-error" className="form-error" role="alert">
                {inputError}
              </p>
            ) : null}
            <div className="chips" aria-label="예시 문장">
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" className="chip" onClick={() => send(ex)}>
                  {ex}
                </button>
              ))}
            </div>
            <button className="btn" type="submit">
              보내기
            </button>
          </form>
        </section>
      ) : null}

      {step === "location" ? (
        <section className="stack">
          <h1 ref={headingRef} tabIndex={-1}>
            정확한 지도를 위해 현재 위치가 필요해요
          </h1>
          <p className="muted">
            버튼을 누른 뒤 화면에 위치 권한을 묻는 창이 뜨면 <strong>허용</strong>을 눌러 주세요. 지도에는 약 200m
            단위의 대략적인 위치만 보여요.
          </p>
          {demoMode ? (
            <label className="card" style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={useDemoCoords}
                onChange={(e) => setUseDemoCoords(e.target.checked)}
                style={{ width: 24, height: 24 }}
              />
              <span>
                테스트 좌표 사용 <span className="muted small">(시연 모드, 애월읍)</span>
              </span>
            </label>
          ) : null}
          <button className="btn" onClick={requestLocation} disabled={busy}>
            {busy ? "위치 확인 중이에요" : "위치 허용"}
          </button>
        </section>
      ) : null}

      {step === "processing" || step === "saving" ? (
        <section className="stack" aria-busy="true">
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div className="spinner" aria-hidden="true" />
            <h1 ref={headingRef} tabIndex={-1} style={{ margin: 0 }}>
              {step === "processing" ? "AI가 냄새 강도와 종류를 정리하고 있어요" : "제보를 저장하고 있어요"}
            </h1>
          </div>
        </section>
      ) : null}

      {step === "confirm" ? (
        <section className="stack">
          <h1 ref={headingRef} tabIndex={-1}>
            지금 냄새는 몇 단계인가요?
          </h1>
          <div className="intensity-grid" role="group" aria-label="냄새 강도 선택">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} className="intensity-btn" onClick={() => chooseIntensity(n)}>
                <span
                  className="intensity-num"
                  style={{ background: INTENSITY_COLORS[n], color: n >= 4 ? "#fff" : undefined }}
                >
                  {n}
                </span>
                <span>
                  {INTENSITY_LABELS[n].short}
                  <span className="muted small" style={{ display: "block", fontWeight: 400 }}>
                    {INTENSITY_LABELS[n].full}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {step === "done" && saved ? (
        <section className="stack">
          <h1 ref={headingRef} tabIndex={-1}>
            제보가 접수됐어요
          </h1>
          <div className="card">
            <dl className="facts">
              <dt>시각</dt>
              <dd>{formatTime(saved.reported_at)}</dd>
              <dt>강도</dt>
              <dd>
                {saved.intensity} · {INTENSITY_LABELS[saved.intensity].short}
              </dd>
              <dt>냄새 종류</dt>
              <dd>{saved.odor_type}</dd>
            </dl>
            <p style={{ marginBottom: 0 }}>
              오늘 주변(1km) 제보 <strong>{saved.today_nearby_count}건</strong>
            </p>
          </div>
          {saved.merged ? <p className="notice">30분 안에 같은 곳에서 보낸 제보라 하나로 합쳐졌어요.</p> : null}
          <p className="muted small">{SAFETY_TEXT}</p>
          <Link href="/map?from=report" className="btn">
            오늘 지도 보기
          </Link>
          <button className="btn secondary" onClick={restart}>
            처음으로
          </button>
        </section>
      ) : null}

      {step === "error" ? (
        <section className="stack">
          <h1 ref={headingRef} tabIndex={-1}>
            {errorMessage}
          </h1>
          <p>밖으로 나가 위치 권한을 켠 뒤 다시 눌러 주세요.</p>
          <button className="btn" onClick={retry}>
            다시 시도
          </button>
          <button className="btn secondary" onClick={() => setShowHelp((v) => !v)} aria-expanded={showHelp}>
            가족·이장에게 부탁하는 방법
          </button>
          {showHelp ? (
            <div className="card">
              <p>
                <strong>위치 권한 켜기</strong>
              </p>
              <ol style={{ margin: "0 0 12px", paddingLeft: 22 }}>
                <li>휴대폰 설정에서 위치(GPS)를 켜 주세요.</li>
                <li>카카오톡이나 인터넷 앱의 위치 권한을 &lsquo;허용&rsquo;으로 바꿔 주세요.</li>
                <li>건물 밖으로 나가 [다시 시도]를 눌러 주세요.</li>
              </ol>
              <p style={{ marginBottom: 0 }}>
                어렵다면 냄새가 나는 그 자리에서 가족이나 이장님이 대신 보내 주셔도 돼요. 위치는 보내는 사람의 휴대폰
                위치로 기록돼요.
              </p>
            </div>
          ) : null}
          <p className="muted small">위치가 없는 제보는 저장하지 않아요. 위치 실패 횟수만 이름 없이 집계해요.</p>
        </section>
      ) : null}
    </main>
  );
}

function resultCard(intensity: number, odor: OdorType, symptoms: string[]) {
  return `강도 ${intensity} · ${INTENSITY_LABELS[intensity].short} / 냄새 종류: ${odor}${
    symptoms.length ? ` / 증상: ${symptoms.join(", ")}` : ""
  }`;
}
