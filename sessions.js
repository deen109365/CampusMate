// sessions.js - pure helpers for study sessions, ratings and unread logic (unit-tested in tests.html)

export function tsMillis(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts.toDate === "function") return ts.toDate().getTime();
  if (ts instanceof Date) return ts.getTime();
  const n = new Date(ts).getTime();
  return isNaN(n) ? 0 : n;
}

export function todayString(now = new Date()) {
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return now.getFullYear() + "-" + m + "-" + d;
}

export function sessionStart(s) {
  if (!s || !s.date || !s.time) return null;
  const d = new Date(`${s.date}T${s.time}:00`);
  return isNaN(d) ? null : d;
}

export function validateSession({ date, time, place } = {}, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return "Choose a date.";
  if (!/^\d{2}:\d{2}$/.test(time || "")) return "Choose a time.";
  const start = sessionStart({ date, time });
  if (!start) return "That date or time is not valid.";
  if (start.getTime() < now.getTime()) return "Pick a time in the future.";
  const p = String(place || "").trim();
  if (p.length < 2) return "Add a place (at least 2 characters).";
  if (p.length > 60) return "Place is too long (60 characters max).";
  return "";
}

export function isActive(s) {
  return !!s && (s.status === "proposed" || s.status === "accepted");
}

export function isUpcoming(s, now = new Date()) {
  const st = sessionStart(s);
  return !!st && st.getTime() >= now.getTime();
}

export function needsRating(s, now = new Date(), ratedIds = new Set()) {
  const st = sessionStart(s);
  return !!s && s.status === "accepted" && !!st && st.getTime() <= now.getTime() && !ratedIds.has(s.id);
}

export function pendingForMe(sessions, myUid, now = new Date()) {
  return (sessions || []).filter((s) => s.status === "proposed" && s.proposedBy !== myUid && isUpcoming(s, now));
}

export function sortByStart(list) {
  return [...list].sort((a, b) => {
    const x = sessionStart(a), y = sessionStart(b);
    return (x ? x.getTime() : 0) - (y ? y.getTime() : 0);
  });
}

function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function describeWhen(s, now = new Date()) {
  const st = sessionStart(s);
  if (!st) return "";
  const diff = Math.round((startOfDay(st) - startOfDay(now)) / 86400000);
  if (diff === 0) return "Today at " + s.time;
  if (diff === 1) return "Tomorrow at " + s.time;
  if (diff === -1) return "Yesterday at " + s.time;
  return st.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) + " at " + s.time;
}

// earliest accepted session starting within the next `hours` hours
export function reminderFor(sessions, now = new Date(), hours = 24) {
  const limit = now.getTime() + hours * 3600000;
  const list = (sessions || []).filter((s) => {
    const st = sessionStart(s);
    return s.status === "accepted" && st && st.getTime() >= now.getTime() && st.getTime() <= limit;
  });
  return sortByStart(list)[0] || null;
}

export function averageRating(list) {
  const items = (list || []).filter((r) => r && r.stars >= 1 && r.stars <= 5);
  if (!items.length) return { avg: 0, count: 0 };
  const sum = items.reduce((t, r) => t + r.stars, 0);
  return { avg: Math.round((sum / items.length) * 10) / 10, count: items.length };
}

export function isUnread(latest, read, myUid) {
  if (!latest || latest.senderUid === myUid) return false;
  const l = tsMillis(latest.createdAt);
  if (!l) return false;
  return !read || l > tsMillis(read.at);
}

// has the partner read my message? (partnerRead is their reads/{uid} document)
export function isSeen(message, partnerRead) {
  if (!message || !partnerRead) return false;
  const sent = tsMillis(message.createdAt);
  const read = tsMillis(partnerRead.at);
  return sent > 0 && read >= sent;
}

// --- Calendar export ---
const pad2 = (n) => String(n).padStart(2, "0");
function fmtLocal(d) {
  return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + "T" + pad2(d.getHours()) + pad2(d.getMinutes()) + "00";
}

export function sessionTimes(s, minutes = 60) {
  const st = sessionStart(s);
  if (!st) return null;
  return { start: fmtLocal(st), end: fmtLocal(new Date(st.getTime() + minutes * 60000)) };
}

function icsEscape(text) {
  return String(text).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

export function buildIcs(s, partnerName, now = new Date()) {
  const t = sessionTimes(s);
  if (!t) return "";
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CampusMate//Study Session//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    "UID:" + s.id + "@campusmate",
    "DTSTAMP:" + stamp,
    "DTSTART:" + t.start,
    "DTEND:" + t.end,
    "SUMMARY:" + icsEscape("Study session with " + partnerName),
    "LOCATION:" + icsEscape(s.place || ""),
    "DESCRIPTION:" + icsEscape("Study session arranged on CampusMate."),
    "BEGIN:VALARM",
    "TRIGGER:-PT30M",
    "ACTION:DISPLAY",
    "DESCRIPTION:Study session starts soon",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");
}

export function googleCalendarUrl(s, partnerName) {
  const t = sessionTimes(s);
  if (!t) return "";
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: "Study session with " + partnerName,
    dates: t.start + "/" + t.end,
    details: "Study session arranged on CampusMate.",
    location: s.place || ""
  });
  return "https://calendar.google.com/calendar/render?" + params.toString();
}

// minutes until a confirmed session starts (null if not confirmed / invalid)
export function minutesUntil(s, now = new Date()) {
  const st = sessionStart(s);
  if (!st || s.status !== "accepted") return null;
  return Math.round((st.getTime() - now.getTime()) / 60000);
}