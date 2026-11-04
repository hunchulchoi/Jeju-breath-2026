import { CONSENT_VERSION } from "@/lib/types";

const CONSENT_KEY = "jbb_consent";

/** 이 기기에 현재 문구 버전의 동의 기록이 있는가 (제보 화면·홈이 함께 쓴다) */
export function hasConsent(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) === CONSENT_VERSION;
  } catch {
    return false;
  }
}

export function saveConsent() {
  try {
    localStorage.setItem(CONSENT_KEY, CONSENT_VERSION);
  } catch {
    // 저장하지 못해도 이번에는 계속할 수 있다
  }
}
