/** Duration and timestamp formatting shared by the workflow catalog and the jobs page. */

/** Every duration in the app, live or measured: "0:42", "3:07", "1:02:11".
 *
 * One format, so the run time on a workflow card and the clock ticking on that job's
 * tile are the same number in the same shape. A measured median is not rounded to the
 * nearest minute — that throws away the precision the run history actually has. */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/** Seconds between two API timestamps, or null if either is missing. */
export function secondsBetween(from?: string | null, to?: string | null): number | null {
  if (!from || !to) return null;
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, (end - start) / 1000);
}

/** Short relative time for a past timestamp: "just now", "6 min ago", "2 d ago". */
export function timeAgo(timestamp?: string | null, now: number = Date.now()): string {
  if (!timestamp) return "";
  const then = Date.parse(timestamp);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, (now - then) / 1000);
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86400)} d ago`;
}
