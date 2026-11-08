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

// ---- adding people to an existing group (only the creator can do this) ----
export function canAddMembers(group, myUid) {
  const members = (group && group.members) || [];
  return !!group && group.ownerUid === myUid && members.includes(myUid) && members.length < MAX_GROUP_MEMBERS;
}

// Study partners (objects with uid and name) who are not in the group yet.
export function addablePartners(partners, group) {
  const inGroup = new Set((group && group.members) || []);
  const seen = new Set();
  return (partners || []).filter((p) => {
    if (!p || !p.uid || inGroup.has(p.uid) || seen.has(p.uid)) return false;
    seen.add(p.uid);
    return true;
  });
}

export function validateAddMembers(group, selectedUids) {
  const uniq = new Set(selectedUids || []);
  if (uniq.size < 1) return "Pick at least one person to add.";
  const room = MAX_GROUP_MEMBERS - ((group && group.members) || []).length;
  if (uniq.size > room) return room <= 0 ? "This group is full." : "You can add up to " + room + " more " + (room === 1 ? "person" : "people") + ".";
  return "";
}

// The fields saved when people are added: the old members stay first, in the same order.
export function buildAddUpdate(group, others) {
  const members = [...((group && group.members) || [])];
  const memberNames = { ...((group && group.memberNames) || {}) };
  for (const o of others || []) {
    if (o && o.uid && !members.includes(o.uid)) { members.push(o.uid); memberNames[o.uid] = o.name; }
  }
  return { members, memberNames };
}

// One line for the group list: the latest message, or the member names when there are no messages yet.
export function groupSnippet(group, latest, myUid) {
  if (!latest || !latest.text) return memberLabel(group, myUid);
  const who = latest.senderUid === myUid ? "You" : (latest.senderName || "Member");
  return who + ": " + String(latest.text);
}
