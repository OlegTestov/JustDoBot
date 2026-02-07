/** Convert SQLite UTC datetime string to user's timezone (YYYY-MM-DD HH:mm) */
export function formatUtcForTz(utcDatetime: string, timezone: string): string {
  const date = new Date(utcDatetime.endsWith("Z") ? utcDatetime : `${utcDatetime}Z`);
  return date.toLocaleString("sv-SE", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
