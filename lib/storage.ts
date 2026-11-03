import { DeleteObjectCommand, GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/** 사진 저장소. 운영은 MinIO(S3 호환), 테스트는 메모리 구현을 쓴다. */
export interface PhotoStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** 없으면 null */
  get(key: string): Promise<{ body: Uint8Array; contentType: string } | null>;
  delete(key: string): Promise<void>;
}

export function s3Store(): PhotoStore {
  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
    throw new Error("S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY가 필요해요.");
  }
  const client = new S3Client({
    endpoint: S3_ENDPOINT,
    region: process.env.S3_REGION || "us-east-1",
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
    credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
    maxAttempts: 2,
    requestHandler: { requestTimeout: 10_000, connectionTimeout: 5_000 },
  });
  const Bucket = S3_BUCKET;
  return {
    async put(Key, Body, ContentType) {
      await client.send(new PutObjectCommand({ Bucket, Key, Body, ContentType }));
    },
    async get(Key) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket, Key }));
        if (!res.Body) return null;
        return { body: await res.Body.transformToByteArray(), contentType: res.ContentType ?? "image/jpeg" };
      } catch (e) {
        if (e instanceof NoSuchKey) return null;
        throw e;
      }
    },
    async delete(Key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key }));
    },
  };
}

export function memoryStore(): PhotoStore & { objects: Map<string, { body: Buffer; contentType: string }> } {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  return {
    objects,
    async put(key, body, contentType) {
      objects.set(key, { body, contentType });
    },
    async get(key) {
      const o = objects.get(key);
      return o ? { body: new Uint8Array(o.body), contentType: o.contentType } : null;
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}

const g = globalThis as unknown as { __jejuStore?: PhotoStore };

export function getStore(): PhotoStore {
  g.__jejuStore ??= s3Store();
  return g.__jejuStore;
}
