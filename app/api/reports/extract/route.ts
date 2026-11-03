import { extractOdor } from "@/lib/claude";
import { error, json, readJson } from "@/lib/http";
import { validateText } from "@/lib/reports";

export async function POST(req: Request) {
  const body = (await readJson(req)) as { text?: unknown } | null;
  const text = validateText(body?.text);
  if (!text.ok) return error(text.error);
  const { source, ...result } = await extractOdor(text.text);
  return json({ ...result, ai: source === "ai" });
}
