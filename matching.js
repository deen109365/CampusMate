// matching.js - pure functions (no Firebase), unit-tested in tests.html

export function overlap(a = [], b = []) {
  const set = new Set(b);
  return a.filter((x) => set.has(x));
}

export function formatsCompatible(a, b) {
  if (!a || !b) return false;
  return a === "Either" || b === "Either" || a === b;
}

export function pairId(uidA, uidB) {
  return [uidA, uidB].sort().join("_");
}

export function isValidModule(code) {
  return /^[A-Z]{2,4}[0-9]{3,5}$/.test(String(code || "").trim().toUpperCase());
}

export function normaliseModule(code) {
  return String(code || "").replace(/\s+/g, "").toUpperCase();
}

export function matchLabel(score) {
  if (score >= 6) return "Excellent match";
  if (score >= 3) return "Great match";
  return "Good match";
}

// me: {module, days[], times[], format, goal}; others: [{uid, name, module, days, times, format, goal, visible}]
// Returns compatible people sorted by best overlap first.
export function findCompatible(me, others) {
  if (!me || !me.module) return [];
  const results = [];
  for (const other of others || []) {
    if (!other || other.uid === me.uid) continue;
    if (other.visible === false) continue;
    if (normaliseModule(other.module) !== normaliseModule(me.module)) continue;
    const sharedDays = overlap(me.days, other.days);
    const sharedTimes = overlap(me.times, other.times);
    if (!sharedDays.length || !sharedTimes.length) continue;
    if (!formatsCompatible(me.format, other.format)) continue;
    // people with the same study goal rank higher (it never excludes anyone)
    const sameGoal = !!me.goal && !!other.goal && me.goal === other.goal;
    const score = sharedDays.length * sharedTimes.length + (sameGoal ? 2 : 0);
    results.push({ user: other, sharedDays, sharedTimes, sameGoal, score });
  }
  return results.sort((a, b) => b.score - a.score);
}