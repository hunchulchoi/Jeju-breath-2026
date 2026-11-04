"use client";

import Link from "next/link";
import { forwardRef, useState } from "react";
import { hasHealthConsent } from "../components/useConsent";

const SAFETY_NOTE =
  "이 서비스는 주민 제보를 모아 보여 줄 뿐 냄새의 원인이나 책임을 판단하지 않아요. 건강에 이상이 느껴지면 119 또는 의료기관에 문의하세요.";

/** 안내 + 동의 화면. 둘 다 체크해야 계속할 수 있다. reviewing이면 이미 동의한 사람이 내용을 다시 보는 중이다. */
const ConsentStep = forwardRef<
  HTMLHeadingElement,
  { reviewing?: boolean; onAgree: (opts: { health: boolean }) => void; onDecline?: () => void }
>(function ConsentStep({ reviewing = false, onAgree, onDecline }, headingRef) {
  const [privacy, setPrivacy] = useState(reviewing);
  const [location, setLocation] = useState(reviewing);
  const [health, setHealth] = useState(() => (reviewing ? hasHealthConsent() : false));
  const required = privacy && location;
  const all = required && health;

  return (
    <section className="stack" aria-labelledby="consent-title">
      <h1 id="consent-title" ref={headingRef} tabIndex={-1}>
        냄새 제보는 이렇게 해요
      </h1>
      <ol className="steps">
        <li>아래 두 가지(필수)에 동의해요. 몸 상태 정보는 원하면 동의해요.</li>
        <li>지도에서 내 위치를 확인해요.</li>
        <li>냄새 세기를 고르고 보내요.</li>
      </ol>
      <p className="muted small">{SAFETY_NOTE}</p>

      <label className="check-row all">
        <input
          type="checkbox"
          checked={all}
          onChange={(e) => {
            setPrivacy(e.target.checked);
            setLocation(e.target.checked);
            setHealth(e.target.checked);
          }}
        />
        <span>모두 동의해요</span>
      </label>

      <div className="consent-item">
        <label className="check-row">
          <input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} />
          <span>[필수] 개인정보 수집·이용에 동의해요</span>
        </label>
        <details>
          <summary>내용 보기</summary>
          <dl className="consent-text">
            <dt>모으는 것</dt>
            <dd>
              제보한 시각, 냄새 세기와 종류, 사진(선택), 생활 불편(창문 닫음 등, 선택)이에요. 생활 불편은 지도에
              공개해요. 사진은 촬영 정보를 지우고 지도에 공개해요. 기기 임의
              번호도 모아요. 이 번호는 암호화해서 같은 사람이 중복 제보했는지 알아보는 데만 써요.
            </dd>
            <dt>쓰는 목적</dt>
            <dd>악취 제보 지도를 만들어요.</dd>
            <dt>보관 기간</dt>
            <dd>시범 운영이 끝나면 1주 안에 지워요.</dd>
            <dt>동의하지 않으면</dt>
            <dd>동의하지 않을 수 있어요. 그러면 제보할 수 없어요. 지도 보기는 할 수 있어요.</dd>
          </dl>
        </details>
      </div>

      <div className="consent-item">
        <label className="check-row">
          <input type="checkbox" checked={location} onChange={(e) => setLocation(e.target.checked)} />
          <span>[필수] 위치정보 수집·이용에 동의해요</span>
        </label>
        <details>
          <summary>내용 보기</summary>
          <dl className="consent-text">
            <dt>모으는 것</dt>
            <dd>제보할 때 휴대폰의 현재 위치예요.</dd>
            <dt>쓰는 방법</dt>
            <dd>
              약 200m 단위로 바꿔서 지도에 보여 줘요. 정확한 좌표는 제보가 맞는지 확인한 직후 지워요.
            </dd>
            <dt>보관 기간</dt>
            <dd>200m 단위 위치는 시범 운영이 끝나면 1주 안에 지워요.</dd>
            <dt>동의하지 않으면</dt>
            <dd>동의하지 않을 수 있어요. 그러면 제보할 수 없어요. 지도 보기는 할 수 있어요.</dd>
          </dl>
        </details>
      </div>

      <div className="consent-item">
        <label className="check-row">
          <input type="checkbox" checked={health} onChange={(e) => setHealth(e.target.checked)} />
          <span>[선택] 몸 상태 정보 수집·이용에 동의해요</span>
        </label>
        <details>
          <summary>내용 보기</summary>
          <dl className="consent-text">
            <dt>모으는 것</dt>
            <dd>두통, 메스꺼움, 숨 막힘, 눈 따가움 중 제보할 때 직접 고른 것이에요.</dd>
            <dt>쓰는 목적</dt>
            <dd>악취와 건강 영향을 묶음 통계로 살펴봐요.</dd>
            <dt>공개 여부</dt>
            <dd>지도와 목록에 공개하지 않아요. 묶음 통계로만 써요.</dd>
            <dt>보관 기간</dt>
            <dd>시범 운영이 끝나면 1주 안에 지워요.</dd>
            <dt>동의하지 않으면</dt>
            <dd>동의하지 않아도 제보할 수 있어요. 몸 상태 칸만 쓸 수 없어요.</dd>
          </dl>
        </details>
      </div>

      <button className="btn" type="button" disabled={!required} onClick={() => onAgree({ health })}>
        {reviewing ? "동의한 상태로 계속" : "모두 동의하고 계속"}
      </button>
      {!required ? (
        <p className="muted small" role="status">
          필수 두 가지에 체크하면 계속할 수 있어요.
        </p>
      ) : null}
      {onDecline ? (
        <button type="button" className="btn secondary" onClick={onDecline}>
          동의하지 않고 지도만 보기
        </button>
      ) : (
        <Link href="/map" className="btn secondary">
          동의하지 않고 지도만 보기
        </Link>
      )}
    </section>
  );
});

export default ConsentStep;
