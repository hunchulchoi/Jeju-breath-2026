import { describe, expect, it } from "vitest";
import { maskPersonalInfo } from "@/lib/mask";

describe("개인정보 마스킹", () => {
  it("전화번호", () => {
    expect(maskPersonalInfo("냄새 심해요 010-1234-5678로 연락주세요")).toBe("냄새 심해요 [전화번호]로 연락주세요");
    expect(maskPersonalInfo("01012345678")).toBe("[전화번호]");
    expect(maskPersonalInfo("064 712 3456 이장님")).toBe("[전화번호] 이장님");
  });

  it("이메일", () => {
    expect(maskPersonalInfo("메일 jeju.kim@example.com 으로")).toBe("메일 [이메일] 으로");
  });

  it("이름 소개와 '씨'", () => {
    expect(maskPersonalInfo("저는 김순자예요 냄새가 심해요")).toBe("저는 [이름]예요 냄새가 심해요");
    expect(maskPersonalInfo("제 이름은 홍길동 입니다")).toBe("제 이름은 [이름] 입니다");
    expect(maskPersonalInfo("옆집 박철수 씨도 힘들대요")).toBe("옆집 [이름] 씨도 힘들대요");
  });

  it("악취 문장과 숫자는 그대로 둔다", () => {
    const s = "축사 냄새 때문에 창문을 못 열겠어요. 강도 4, 2시간째";
    expect(maskPersonalInfo(s)).toBe(s);
  });
});
