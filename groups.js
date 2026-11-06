// groups.js - pure helpers for study groups (no Firebase, no DOM).
import { pairId } from "./matching.js";

export const MAX_GROUP_MEMBERS = 5;   // including the creator
export const MAX_GROUP_NAME = 40;

export function validateGroupName(name) {
  const n = String(name || "").trim();
  if (n.length < 2) return "Give the group a name (at least 2 letters).";
  if (n.length > MAX_GROUP_NAME) return "Group names can be up to " + MAX_GROUP_NAME + " characters.";
  return "";
}

export function validateGroupMembers(selectedUids) {
  const uniq = new Set(selectedUids || []);
  if (uniq.size < 1) return "Pick at least one study partner.";
  if (uniq.size + 1 > MAX_GROUP_MEMBERS) return "A group can have up to " + MAX_GROUP_MEMBERS + " people including you.";
  return "";
}

// The document saved for a new group. The creator is always members[0].
export function buildGroup({ name, module, ownerUid, ownerName, others }) {
  const list = [];
  const seen = new Set([ownerUid]);
  for (const o of others || []) if (o && o.uid && !seen.has(o.uid)) { seen.add(o.uid); list.push(o); }
  const memberNames = { [ownerUid]: ownerName };
  list.forEach((o) => { memberNames[o.uid] = o.name; });
  return {
    name: String(name).trim(),
    module: module || "",
    ownerUid,
    members: [ownerUid, ...list.map((o) => o.uid)],
    memberNames
  };
}

// Group members must each be an accepted study partner of the creator.
export function requiredPairIds(ownerUid, memberUids) {
  return (memberUids || []).filter((u) => u !== ownerUid).map((u) => pairId(ownerUid, u));
}

export function memberLabel(group, myUid) {
  const names = (group.members || []).map((u) => u === myUid ? "You" : ((group.memberNames || {})[u] || "Member"));
  return names.join(", ");
}

export function canLeaveByDelete(group, myUid) {
  return (group.members || []).length === 1 && group.members[0] === myUid;
}