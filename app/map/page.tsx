import { connection } from "next/server";
import { isValidDay, recentDays } from "@/lib/time";
import MapView from "./MapView";

export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; from?: string }>;
}) {
  await connection();
  const params = await searchParams;
  const days = recentDays(new Date(), 7);
  const initialDay = params.date && isValidDay(params.date) ? params.date : days[0];
  if (!days.includes(initialDay)) days.push(initialDay);
  return <MapView days={days} initialDay={initialDay} fromReport={params.from === "report"} />;
}
