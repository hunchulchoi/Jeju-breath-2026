// 저장 전 원문에서 전화번호·이메일·이름 패턴을 가린다 (PRD 3.5).

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// 010-1234-5678, 01012345678, 064 123 4567, +82 10-1234-5678
const PHONE = /(\+?82[-\s]?)?0?\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/g;
// "제 이름은 홍길동", "저는 홍길동이에요", "이름: 홍길동"
const NAME_INTRO = /(이름은|이름이|이름:|이름 :|저는|나는)\s*([가-힣]{2,4})(?=[\s,.!?]|이에요|예요|입니다|이고|이야|$)/g;
// "홍길동 씨", "홍길동씨"
const NAME_SSI = /([가-힣]{2,4})\s?씨(?=[\s,.!?가이는도에]|$)/g;

export function maskPersonalInfo(text: string): string {
  return text
    .replace(EMAIL, "[이메일]")
    .replace(PHONE, (m) => (m.replace(/\D/g, "").length >= 9 ? "[전화번호]" : m))
    .replace(NAME_INTRO, (_m, intro: string) => `${intro} [이름]`)
    .replace(NAME_SSI, "[이름] 씨");
}
