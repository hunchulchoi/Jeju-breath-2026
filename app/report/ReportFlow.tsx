"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import OdorMap, { Legend } from "../components/OdorMap";
import { AirSource, AirToggle, useAirStations, useShowAir } from "../components/AirToggle";
import { TopBar } from "../components/TopBar";
import ConsentStep from "./ConsentStep";
import { distanceMeters, RULES } from "@/lib/rules";
import { formatTime } from "@/lib/time";
import { CONSENT_VERSION, INTENSITY_COLORS, INTENSITY_LABELS, INTENSITY_TEXT, type OdorType, type PublicReport, type Summary } from "@/lib/types";

// 시연 모드 테스트 좌표 (애월읍)
const DEMO_COORDS = { lat: 33.4262, lng: 126.3361, accuracy: 15 };
// 휴대폰에서 먼저 줄여 보낸다 (시골 이동통신망에서도 빨리 올라가도록). 서버가 다시 처리한다.
const PHOTO_MAX_SIDE = 1600;
const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const PHOTO_MESSAGES: Record<string, string> = {
  invalid: "사진 파일을 읽지 못해 사진은 저장하지 않았어요.",
  too_large: "사진이 너무 커서 저장하지 않았어요.",
  limit: "이 제보에는 사진이 이미 3장 있어 더 붙이지 않았어요.",
  failed: "사진을 올리지 못했어요. 제보는 접수됐어요.",
};
const SAFETY_TEXT =
  "이 정보는 주민 제보 기준이며 원인이나 책임을 판단하지 않아요. 건강 이상이 있으면 119 또는 의료기관에 문의하세요.";
const CONSENT_KEY = "jbb_consent";

// 화면에 보이는 이름과 서버에 보내는 값
// 아이콘은 이모지 (그림 파일 없이 휴대폰에서 바로 보임). 화면 읽기 프로그램은 글자만 읽는다.
const ODOR_CHOICES: { label: string; icon: string; value: OdorType }[] = [
  { label: "돼지 축사", icon: "🐷", value: "양돈" },
  { label: "퇴비·거름", icon: "🌾", value: "퇴비" },
  { label: "액비", icon: "🚜", value: "액비" },
  { label: "기타", icon: "💨", value: "기타" },
  { label: "잘 모르겠어요", icon: "❓", value: "알 수 없음" },
];

type Step = "init" | "consent" | "main" | "saving" | "done";
type Loc = "loading" | "ok" | "error";

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
  photo: "saved" | "invalid" | "too_large" | "limit" | "failed" | null;
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

/** 회전을 반영해 긴 변 1600px JPEG로 다시 그린다. 다시 그리면 촬영 정보(EXIF)도 빠진다. 실패하면 원본 */
async function shrinkPhoto(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    return blob ?? file;
  } catch {
    return file;
  }
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


function hasConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === CONSENT_VERSION;
  } catch {
    return false;
  }
}

function saveConsent() {
  try {
    localStorage.setItem(CONSENT_KEY, CONSENT_VERSION);
  } catch {
    // 저장하지 못해도 이번 제보는 계속할 수 있다
  }
}

// 강도 5 안내: tel: 링크라 자동으로 걸리지 않고 사용자가 누를 때 전화 앱이 열린다
function Emergency119({ text, note }: { text: string; note?: string }) {
  return (
    <div className="emergency-box">
      <p className="emergency-text">{text}</p>
      {note ? <p className="emergency-note">{note}</p> : null}
      <a href="tel:119" className="btn btn-emergency">
        119에 전화하기
      </a>
    </div>
  );
}

export default function ReportFlow({ demoMode, today, kakaoKey }: { demoMode: boolean; today: string; kakaoKey: string }) {
  const [step, setStep] = useState<Step>("init");
  const [reviewing, setReviewing] = useState(false);
  const [useDemoCoords, setUseDemoCoords] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [loc, setLoc] = useState<Loc>("loading");
  const [locTry, setLocTry] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const [reports, setReports] = useState<PublicReport[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [intensity, setIntensity] = useState<number | null>(null);
  const [odor, setOdor] = useState<OdorType>("알 수 없음");
  const [saved, setSaved] = useState<Saved | null>(null);
  const [submitError, setSubmitError] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  // 사진 처리는 오래 걸려서, 늦게 끝난 이전 작업이 새 상태를 덮어쓰지 않게 작업 번호로 최신 것만 반영한다
  const photoJob = useRef(0);
  const mounted = useRef(false);
  // save()가 await 뒤에도 항상 최신 사진을 읽도록 state와 같이 갱신한다
  const photoRef = useRef<Blob | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const startedSent = useRef(false);
  const [showAir, setShowAir] = useShowAir();
  const { air, failed: airFailed } = useAirStations(step === "main" || step === "saving" ? today : null, showAir);

  // 저장된 동의가 현재 문구 버전과 같으면 안내·동의를 건너뛴다
  useEffect(() => {
    setStep(hasConsent() ? "main" : "consent");
  }, []);

  // 단계가 바뀌면 화면 읽기 프로그램이 새 안내를 읽도록 제목으로 초점을 옮긴다
  useEffect(() => {
    if (step !== "init") headingRef.current?.focus();
  }, [step]);

  // 제보 화면에 처음 들어올 때 한 번만 센다
  useEffect(() => {
    if (step === "main" && !startedSent.current) {
      startedSent.current = true;
      postEvent("report_started");
    }
  }, [step]);

  // 미리보기 주소는 바뀌거나 화면을 떠날 때 해제한다
  useEffect(() => {
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    };
  }, [photoUrl]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      photoJob.current += 1;
    };
  }, []);

  // 오늘 제보·요약 (지도와 요약 한 줄)
  useEffect(() => {
    if (step !== "main") return;
    let cancelled = false;
    Promise.all([
      fetch(`/api/reports?date=${today}`).then((r) => (r.ok ? r.json() : Promise.reject())),
      fetch(`/api/summary?date=${today}`).then((r) => (r.ok ? r.json() : Promise.reject())),
    ])
      .then(([list, sum]: [{ reports: PublicReport[] }, Summary]) => {
        if (cancelled) return;
        setReports(list.reports);
        setSummary(sum);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [step, today]);

  // 제보 화면에 들어오면 바로 위치를 확인한다 (테스트 좌표 토글·다시 시도로 다시 실행)
  useEffect(() => {
    if (step !== "main") return;
    let cancelled = false;
    setLoc("loading");
    setCoords(null);
    const p = useDemoCoords ? Promise.resolve(DEMO_COORDS) : getPosition();
    p.then((position) => {
      if (cancelled) return;
      setCoords(position);
      setLoc("ok");
    }).catch(() => {
      if (cancelled) return;
      postLocationFailure();
      setLoc("error");
    });
    return () => {
      cancelled = true;
    };
  }, [step, useDemoCoords, locTry]);

  async function pickPhoto(file: File | undefined) {
    setPhotoError("");
    if (!file) return;
    if (!file.type.startsWith("image/")) return setPhotoError("사진 파일만 올릴 수 있어요.");
    const job = ++photoJob.current;
    setPhotoBusy(true);
    const small = await shrinkPhoto(file);
    // 그 사이 사진을 뺐거나, 처음으로 돌아갔거나, 새 사진을 골랐거나, 화면을 떠났으면 버린다
    if (job !== photoJob.current || !mounted.current) return;
    setPhotoBusy(false);
    if (small.size > PHOTO_MAX_BYTES) return setPhotoError("사진이 너무 커요. 다른 사진을 골라 주세요.");
    photoRef.current = small;
    setPhotoUrl(URL.createObjectURL(small));
  }

  function removePhoto() {
    photoJob.current += 1;
    photoRef.current = null;
    setPhotoBusy(false);
    setPhotoUrl(null);
    setPhotoError("");
  }

  // 요약 한 줄: 내 위치가 있으면 주변 1km, 없으면 오늘 전체
  const nearby = useMemo(() => {
    if (!coords || !reports) return null;
    const near = reports.filter(
      (r) =>
        !r.needs_review &&
        distanceMeters({ lat: coords.lat, lng: coords.lng }, { lat: r.grid_lat, lng: r.grid_lng }) <= RULES.nearbyMeters,
    );
    return { total: near.length, high: near.filter((r) => r.intensity >= 4).length };
  }, [coords, reports]);
  const summaryText = nearby
    ? `오늘 내 주변(1km) 제보 ${nearby.total}건 · 강도 4 이상 ${nearby.high}건`
    : summary
      ? `오늘 제보 ${summary.total}건 · 강도 4 이상 ${summary.high_intensity}건`
      : "오늘 제보를 불러오는 중이에요";

  function submit() {
    if (intensity === null || photoBusy) return;
    return send(intensity, odor, photoRef.current);
  }

  // [저도 악취를 느꼈어요]: 그 칸의 가장 센 제보와 같은 강도·종류로, 사진 없이 내 위치에서 보낸다
  function submitMeToo(r: PublicReport) {
    if (step !== "main") return;
    return send(r.intensity, r.odor_type, null);
  }

  async function send(intensity: number, odor: OdorType, photo: Blob | null) {
    if (!coords) return;
    const position = coords;
    setStep("saving");
    setSubmitError("");
    const data = JSON.stringify({
      user_id: getUserId(),
      lat: position.lat,
      lng: position.lng,
      accuracy: position.accuracy,
      intensity,
      odor_type: odor,
      consent_version: CONSENT_VERSION,
    });
    let init: RequestInit;
    if (photo) {
      const form = new FormData();
      form.append("data", data);
      form.append("photo", photo, "photo.jpg");
      init = { method: "POST", body: form };
    } else {
      init = { method: "POST", headers: { "Content-Type": "application/json" }, body: data };
    }
    try {
      const res = await fetch("/api/reports", init);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 422: 서버가 위치를 거절함 (제주 밖·정확도 부족). 실패 횟수는 서버가 셌다.
        setSubmitError(
          res.status === 422
            ? (body.error ?? "위치를 확인하지 못해 저장하지 않았어요.")
            : "저장 중 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.",
        );
        setStep("main");
        return;
      }
      setSaved({ ...body, intensity, odor_type: odor, photo: body.photo ?? null });
      setStep("done");
    } catch {
      setSubmitError("저장 중 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.");
      setStep("main");
    }
  }

  function restart() {
    // 다음 제보도 제보 화면에 들어온 것으로 한 번 더 센다
    startedSent.current = false;
    setSaved(null);
    setIntensity(null);
    setOdor("알 수 없음");
    setSubmitError("");
    setShowHelp(false);
    setReports(null);
    removePhoto();
    setStep("main");
  }

  const canSubmit = loc === "ok" && !!coords && intensity !== null && !photoBusy;
  const showTestCoords = demoMode && useDemoCoords;
  const hasDemoData = !!summary?.has_demo || !!reports?.some((r) => r.is_demo);

  return (
    <main className="container">
      <TopBar
        badges={
          showTestCoords || hasDemoData ? (
            <>
              {showTestCoords ? <span className="badge">시연 모드: 테스트 좌표</span> : null}
              {hasDemoData ? <span className="badge">시연 모드: 가상 데이터</span> : null}
            </>
          ) : null
        }
      />

      {step === "consent" ? (
        <ConsentStep
          ref={headingRef}
          reviewing={reviewing}
          onAgree={() => {
            saveConsent();
            setReviewing(false);
            setStep("main");
          }}
        />
      ) : null}

      {step === "main" || step === "saving" ? (
        <section className="stack" aria-busy={step === "saving"}>
          <h1 ref={headingRef} tabIndex={-1}>
            내 위치를 확인하고 냄새를 알려 주세요
          </h1>

          <p className="loc-status" role="status" aria-live="polite">
            {loc === "loading" ? "내 위치를 확인하고 있어요" : null}
            {loc === "ok" ? "내 위치를 확인했어요. 지도의 파란 점이 내 위치예요." : null}
            {loc === "error" ? "위치를 확인하지 못해 제보할 수 없어요." : null}
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

          {loc === "error" ? (
            <div className="stack">
              <p>밖으로 나가 휴대폰의 위치 권한을 켠 뒤 다시 눌러 주세요.</p>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setSubmitError("");
                  setLocTry((n) => n + 1);
                }}
              >
                다시 시도
              </button>
              <button className="btn secondary" type="button" onClick={() => setShowHelp((v) => !v)} aria-expanded={showHelp}>
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
            </div>
          ) : null}

          <AirToggle show={showAir} onChange={setShowAir} failed={airFailed} />
          <OdorMap
            kakaoKey={kakaoKey}
            reports={reports}
            air={showAir ? air : undefined}
            me={coords}
            className="map report-map"
            meToo={{ origin: loc === "ok" ? coords : null, onPick: submitMeToo, disabled: step === "saving" }}
          />
          <Legend withMe withAir={showAir} />
          {showAir ? <AirSource /> : null}
          <p className="summary" aria-live="polite">
            {summaryText}
          </p>

          <h2 id="intensity-title">지금 냄새는 어느 정도인가요?</h2>
          <div className="intensity-grid" role="group" aria-labelledby="intensity-title">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={`intensity-btn${intensity === n ? " selected" : ""}`}
                style={{ background: INTENSITY_COLORS[n], color: INTENSITY_TEXT[n] }}
                aria-pressed={intensity === n}
                onClick={() => setIntensity(n)}
              >
                <span className="intensity-num" aria-hidden="true">
                  {n}
                </span>
                <span className="intensity-text">
                  <strong>{INTENSITY_LABELS[n].short}</strong>
                  <span className="intensity-sep"> · </span>
                  <span>{INTENSITY_LABELS[n].full}</span>
                </span>
                {intensity === n ? (
                  <span className="intensity-check" aria-hidden="true">
                    ✓
                  </span>
                ) : null}
              </button>
            ))}
          </div>
          <div aria-live="polite">
            {intensity === 5 ? (
              <Emergency119
                text="숨쉬기 힘들거나 어지럽고 메스꺼우면 바로 119에 전화하세요."
                note="제보는 전화와 따로 보낼 수 있어요."
              />
            ) : null}
          </div>

          <h2 id="odor-title">
            냄새 종류 <span className="muted small">(선택 사항)</span>
          </h2>
          <div className="odor-grid" role="group" aria-labelledby="odor-title">
            {ODOR_CHOICES.map((c) => (
              <button
                key={c.value}
                type="button"
                className={`choice-btn${odor === c.value ? " selected" : ""}`}
                aria-pressed={odor === c.value}
                onClick={() => setOdor(c.value)}
              >
                <span className="choice-icon" aria-hidden="true">
                  {c.icon}
                </span>
                <span>{c.label}</span>
              </button>
            ))}
          </div>

          <div className="photo-pick">
            {photoUrl ? (
              <div className="photo-preview">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoUrl} alt="첨부한 사진 미리보기" />
                <button type="button" className="btn secondary" onClick={removePhoto}>
                  사진 빼기
                </button>
              </div>
            ) : (
              <label className="btn secondary photo-label">
                사진 추가 (선택)
                <input
                  type="file"
                  accept="image/*"
                  className="visually-hidden"
                  onChange={(e) => {
                    void pickPhoto(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
            {photoBusy ? (
              <p className="muted" role="status" aria-live="polite">
                사진을 준비하고 있어요. 잠시만 기다려 주세요.
              </p>
            ) : null}
            {photoError ? (
              <p className="form-error" role="alert">
                {photoError}
              </p>
            ) : null}
            <p className="muted small">
              사람 얼굴·차 번호판·집 안이 나오지 않게 찍어 주세요. 사진은 지도에 공개되고, 촬영 위치 같은 정보는 지운 뒤
              저장해요.
            </p>
          </div>

          {submitError ? (
            <p className="notice" role="alert">
              {submitError}
            </p>
          ) : null}
          <button className="btn" type="button" disabled={!canSubmit || step === "saving"} onClick={submit}>
            {step === "saving"
              ? "제보를 저장하고 있어요"
              : photoBusy
                ? "사진을 준비하고 있어요"
                : loc !== "ok"
                  ? "위치를 확인하면 보낼 수 있어요"
                  : intensity === null
                    ? "냄새 단계를 먼저 골라 주세요"
                    : "제보 보내기"}
          </button>
          <p className="muted small">
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setReviewing(true);
                setStep("consent");
              }}
            >
              동의 내용 보기
            </button>
          </p>
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
          {saved.photo === "saved" ? <p className="muted">사진도 함께 저장했어요.</p> : null}
          {saved.photo && saved.photo !== "saved" ? <p className="notice">{PHOTO_MESSAGES[saved.photo]}</p> : null}
          {saved.intensity === 5 ? <Emergency119 text="숨쉬기 힘들거나 몸이 불편하면 바로 119에 전화하세요." /> : null}
          <p className="muted small">{SAFETY_TEXT}</p>
          <Link href="/map?from=report" className="btn">
            오늘 지도 보기
          </Link>
          <button className="btn secondary" type="button" onClick={restart}>
            처음으로
          </button>
        </section>
      ) : null}
    </main>
  );
}
