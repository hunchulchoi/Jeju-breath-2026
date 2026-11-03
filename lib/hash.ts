import { createHash } from "node:crypto";

/** 제보자 식별자는 SHA-256(salt + 원본 ID)로만 저장한다. */
export function hashUserId(userId: string, salt = process.env.USER_HASH_SALT ?? ""): string {
  return createHash("sha256").update(salt + userId).digest("hex");
}
