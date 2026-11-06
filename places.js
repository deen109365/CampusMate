// places.js - pure helpers for the "study places near me" map (no network, no DOM).
// Data comes from OpenStreetMap through the Overpass API.

export const KINDS = { library: "Library", cafe: "Cafe", park: "Park" };

export function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function formatDistance(m) {
  if (!isFinite(m) || m < 0) return "";
  if (m < 1000) return Math.max(10, Math.round(m / 10) * 10) + " m";
  return (m / 1000).toFixed(1) + " km";
}

// Overpass QL: libraries, cafes and named parks within radius metres of a point.
export function buildOverpassQuery(lat, lon, radius = 1500) {
  const la = Number(lat), lo = Number(lon), r = Math.max(100, Math.min(5000, Math.round(Number(radius) || 1500)));
  if (!isFinite(la) || !isFinite(lo)) throw new Error("bad-coordinates");
  const at = `(around:${r},${la.toFixed(4)},${lo.toFixed(4)})`;
  return `[out:json][timeout:15];(nwr["amenity"~"^(library|cafe)$"]${at};nwr["leisure"="park"]["name"]${at};);out center 60;`;
}

function kindOf(tags) {
  if (!tags) return null;
  if (tags.amenity === "library") return "library";
  if (tags.amenity === "cafe") return "cafe";
  if (tags.leisure === "park") return "park";
  return null;
}

// Turn an Overpass response into a clean list, nearest first. Unnamed places are dropped.
export function parsePlaces(json, lat, lon, max = 30) {
  const seen = new Set();
  const out = [];
  for (const e of (json && json.elements) || []) {
    const kind = kindOf(e.tags);
    const name = e.tags && typeof e.tags.name === "string" ? e.tags.name.trim().slice(0, 80) : "";
    const pLat = e.lat !== undefined ? e.lat : e.center && e.center.lat;
    const pLon = e.lon !== undefined ? e.lon : e.center && e.center.lon;
    if (!kind || !name || !isFinite(pLat) || !isFinite(pLon)) continue;
    const key = kind + "|" + name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: String(e.type || "x") + String(e.id), name, kind, lat: pLat, lon: pLon, distance: haversineM(lat, lon, pLat, pLon) });
  }
  out.sort((a, b) => a.distance - b.distance);
  return out.slice(0, max);
}

export function filterByKind(list, kind) {
  return !kind || kind === "all" ? list.slice() : list.filter((p) => p.kind === kind);
}