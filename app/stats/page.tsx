import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { getStats } from "@/lib/stats";
import { seoulDay } from "@/lib/time";
import StatsView from "./StatsView";

export default async function StatsPage() {
  await connection();
  const initial = await getStats(await getDb(), { days: 7, today: seoulDay(new Date()) });
  return <StatsView initial={initial} />;
}
