"use client";

import { useEffect, useRef, type RefObject } from "react";
import {
  airCardData,
  pickMeToo,
  photoSrc,
  reportCardData,
  selectionKey,
  windCardData,
  type MapSelection,
  type MeToo,
} from "./odorMapCommon";
import type { PublicReport } from "@/lib/types";

type TitleRef = RefObject<HTMLHeadingElement | null>;

/**
 * 지도 바로 아래 '선택한 곳' 카드. 지도 위 팝업 대신 쓴다 (지도를 옮기지 않아 마커가 다시 그려지지 않는다).
 * 열리거나 다른 곳으로 바뀌면 제목으로 초점이 옮겨 가고, aria-live로 읽힌다.
 */
export default function SelectionCard({
  selection,
  meToo,
  reports,
  onClose,
}: {
  selection: MapSelection | null;
  meToo?: MeToo;
  reports: PublicReport[] | null;
  onClose: () => void;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const key = selection ? selectionKey(selection) : null;
  useEffect(() => {
    if (key) titleRef.current?.focus();
  }, [key]);

  return (
    <div className="select-card-live" aria-live="polite">
      {selection ? (
        <section className="select-card" aria-label="선택한 곳">
          {selection.kind === "reports" ? (
            <ReportBody group={selection.group} meToo={meToo} reports={reports} onClose={onClose} titleRef={titleRef} />
          ) : selection.kind === "air" ? (
            <AirBody station={selection.station} titleRef={titleRef} />
          ) : (
            <WindBody point={selection.point} titleRef={titleRef} />
          )}
          <button type="button" className="select-card-close" onClick={onClose}>
            닫기
          </button>
        </section>
      ) : null}
    </div>
  );
}

function ReportBody({
  group,
  meToo,
  reports,
  onClose,
  titleRef,
}: {
  group: Extract<MapSelection, { kind: "reports" }>["group"];
  meToo?: MeToo;
  reports: PublicReport[] | null;
  onClose: () => void;
  titleRef: TitleRef;
}) {
  const d = reportCardData(group, meToo);
  const offer = d.meToo;
  return (
    <>
      <h3 ref={titleRef} tabIndex={-1}>
        {d.title}
      </h3>
      {d.needsReview ? <p className="select-card-review">확인 필요 (요약에서 제외)</p> : null}
      <ul className="select-card-lines">
        {d.lines.map((l) => (
          <li key={l.id}>
            {l.text}
            {l.photoIds.length ? (
              <span className="popup-photos">
                {l.photoIds.map((pid) => (
                  <a key={pid} href={photoSrc(pid)} target="_blank" rel="noopener">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photoSrc(pid)} alt="제보 사진" loading="lazy" />
                  </a>
                ))}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {offer ? (
        <div className="me-too">
          <button
            type="button"
            className="me-too-btn"
            onClick={() => {
              if (pickMeToo(offer.id, meToo, reports)) onClose();
            }}
          >
            저도 악취를 느꼈어요
          </button>
          <div className="me-too-help">
            내 위치에서 같은 세기({offer.intensity} · {offer.label})로 제보돼요
          </div>
        </div>
      ) : null}
    </>
  );
}

function AirBody({ station, titleRef }: { station: Extract<MapSelection, { kind: "air" }>["station"]; titleRef: TitleRef }) {
  const d = airCardData(station);
  return (
    <>
      <h3 ref={titleRef} tabIndex={-1}>
        {d.title}
      </h3>
      <p>{d.measured}</p>
      <p>
        통합대기 등급: <strong>{d.grade}</strong>
      </p>
      {d.rows.map((r) => (
        <p key={r.name}>
          {r.name} {r.value}
        </p>
      ))}
      <p className="muted small">{d.source}</p>
    </>
  );
}

function WindBody({ point, titleRef }: { point: Extract<MapSelection, { kind: "wind" }>["point"]; titleRef: TitleRef }) {
  const d = windCardData(point);
  return (
    <>
      <h3 ref={titleRef} tabIndex={-1}>
        {d.title}
      </h3>
      {d.lines.map((l, i) => (
        <p key={i}>{l}</p>
      ))}
      <p className="muted small">{d.source}</p>
    </>
  );
}
