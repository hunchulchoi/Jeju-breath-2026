import { getDb } from "@/lib/db";
import { dayParam, error, json, readJson } from "@/lib/http";
import { listReports, parseReportBody, submitReport } from "@/lib/reports";

const PROBLEM_MESSAGES = {
  missing: "위치를 확인하지 못해 저장하지 않았어요.",
  out_of_bounds: "제주도 밖 위치라 저장하지 않았어요.",
  low_accuracy: "위치가 정확하지 않아 저장하지 않았어요.",
} as const;

export async function GET(req: Request) {
  const day = dayParam(req);
  if (!day) return error("date는 YYYY-MM-DD 형식이어야 해요.");
  return json({ date: day, reports: listReports(getDb(), day) });
}

export async function POST(req: Request) {
  const parsed = parseReportBody(await readJson(req));
  if (!parsed.ok) return error(parsed.error, parsed.status);
  const result = submitReport(getDb(), parsed.input);
  if (!result.ok) {
    return json({ error: PROBLEM_MESSAGES[result.problem], problem: result.problem }, 422);
  }
  const { ok: _ok, ...body } = result;
  return json(body, 201);
}
