import { getDb } from "@/lib/db";
import { error } from "@/lib/http";
import { getPublicPhoto } from "@/lib/photos";
import { getStore } from "@/lib/storage";

// MinIO 버킷은 비공개로 두고, 공개해도 되는 사진만 서버를 거쳐 내보낸다.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^\d{1,9}$/.test(id)) return error("사진을 찾을 수 없어요.", 404);
  const photo = await getPublicPhoto(await getDb(), getStore(), Number(id));
  if (!photo) return error("사진을 찾을 수 없어요.", 404);
  return new Response(Buffer.from(photo.body), {
    headers: {
      "Content-Type": photo.contentType,
      // 확인 필요로 바뀌면 바로 감춰야 하므로 브라우저·중간 캐시에 남기지 않는다
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
