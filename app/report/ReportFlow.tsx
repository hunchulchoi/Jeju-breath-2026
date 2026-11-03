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

export default function ReportFlow({
  demoMode,
  draft = null,
  draftExpired = false,
}: {
  demoMode: boolean;
  draft?: { token: string; text: string } | null;
  draftExpired?: boolean;
}) {
  // 카카오 초안이 있으면 문장은 채워진 채 위치 확인부터 시작한다
  const [draftToken, setDraftToken] = useState<string | null>(draft?.token ?? null);
  const [step, setStep] = useState<Step>(draft ? "location" : "input");
  const [text, setText] = useState(draft?.text ?? "");
  const [expiredNotice, setExpiredNotice] = useState(draftExpired);
  const [inputError, setInputError] = useState("");
  const [useDemoCoords, setUseDemoCoords] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [extracted, setExtracted] = useState<Extracted | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  // 사진 처리는 오래 걸려서, 늦게 끝난 이전 작업이 새 상태를 덮어쓰지 않게 작업 번호로 최신 것만 반영한다
  const photoJob = useRef(0);
  const mounted = useRef(false);
  // save()가 await 뒤에도 항상 최신 사진을 읽도록 state와 같이 갱신한다
  const photoRef = useRef<Blob | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // 단계가 바뀌면 화면 읽기 프로그램이 새 안내를 읽도록 제목으로 초점을 옮긴다
  useEffect(() => {
    headingRef.current?.focus();
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

  function send(value = text) {
    if (photoBusy) return;
    const trimmed = value.trim();
    if (!trimmed) return setInputError("냄새를 한 문장으로 적어 주세요.");
    if (trimmed.length > MAX_LEN) return setInputError(`${MAX_LEN}자 이내로 적어 주세요.`);
    setText(trimmed);
    setInputError("");
    // 새로 적은 문장은 만료된 초안과 무관하므로 안내 플래그를 끈다. 남겨 두면 이후 실패 시 [다시 시도]가 restart()를 불러 입력이 지워진다.
    setExpiredNotice(false);
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
    const data = JSON.stringify({
      user_id: getUserId(),
      draft_token: draftToken ?? undefined,
      text,
      lat: position.lat,
      lng: position.lng,
      accuracy: position.accuracy,
      intensity,
      intensity_src: src,
      odor_type: ex.odor_type,
      symptoms: ex.symptoms,
      confidence: src === "ai" ? ex.confidence : null,
    });
    const photo = photoRef.current;
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
      if (res.status === 422) {
        // 서버가 위치를 거절함 (제주 밖·정확도 부족). 실패 횟수는 서버가 셌다.
        setErrorMessage(body.error ?? "위치를 확인하지 못해 저장하지 않았어요.");
        setStep("error");
        return;
      }
      if (res.status === 410) {
        // 초안이 만료됐거나 이미 쓰였다
        setErrorMessage(body.error ?? "링크가 만료됐어요. 카카오톡에서 다시 보내 주세요.");
        setDraftToken(null);
        setExpiredNotice(true);
        setStep("error");
        return;
      }
      if (!res.ok) throw new Error(body.error);
      setSaved({ ...body, intensity, odor_type: ex.odor_type, photo: body.photo ?? null });
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
    // 만료된 링크로는 다시 저장할 수 없으니 입력 단계로 돌려보낸다
    if (expiredNotice) return restart();
    setStep("location");
  }

  function restart() {
    setText("");
    setCoords(null);
    setExtracted(null);
    setSaved(null);
    removePhoto();
    setShowHelp(false);
    setDraftToken(null);
    setExpiredNotice(false);
    setStep("input");
  }

  return (
    <main className="container">
      <TopBar badges={demoMode && useDemoCoords ? <span className="badge">시연 모드: 테스트 좌표</span> : null} />

      {/* 대화 기록 */}
      <div className="chat" aria-live="polite">
        <div className="bubble bot">지금 느끼는 냄새를 한 문장으로 보내 주세요</div>
        {step !== "input" && text ? <div className="bubble user">{text}</div> : null}
        {step !== "input" && photoUrl ? (
          <div className="bubble user photo-bubble">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoUrl} alt="함께 보낸 사진" />
          </div>
        ) : null}
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
          {expiredNotice ? (
            <p className="notice" role="status">
              링크가 만료됐어요. 여기에 다시 적어 주시거나 카카오톡에서 다시 보내 주세요.
            </p>
          ) : null}
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
                <button key={ex} type="button" className="chip" disabled={photoBusy} onClick={() => send(ex)}>
                  {ex}
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
            <button className="btn" type="submit" disabled={photoBusy}>
              {photoBusy ? "사진을 준비하고 있어요" : "보내기"}
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
          {saved.photo === "saved" ? <p className="muted">사진도 함께 저장했어요.</p> : null}
          {saved.photo && saved.photo !== "saved" ? <p className="notice">{PHOTO_MESSAGES[saved.photo]}</p> : null}
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
