/**
 * Run: node scripts/test-workflow-graph.mjs [path-to-history.json]
 * Requires a built bundle or use: npm run build && node ...
 * Quick check: parses sample_workflow_history.json via inlined graph test.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const samplePath =
  process.argv[2] ||
  join(__dirname, "../../../sample_workflow_history.json");

const events = JSON.parse(readFileSync(samplePath, "utf8"));

// Minimal inline of fixed parsers (keep in sync with WorkflowHistoryModal.jsx)
function getAttributesPointer(event) {
  const ptr = event.attributes ?? event.Attributes;
  return typeof ptr === "string" ? ptr : null;
}

function getEventAttrs(event) {
  const ptr = getAttributesPointer(event);
  if (ptr && event[ptr] != null) return event[ptr] || {};
  for (const key of Object.keys(event)) {
    if (/EventAttributes$/i.test(key) && key !== "attributes") {
      return event[key] || {};
    }
  }
  return {};
}

function eventTypeFromAttributesKey(key) {
  const m = key.match(/^(.+?)EventAttributes$/i);
  if (!m) return null;
  return m[1].charAt(0).toUpperCase() + m[1].slice(1);
}

function inferEventType(event) {
  const ptr = getAttributesPointer(event);
  if (ptr) {
    const t = eventTypeFromAttributesKey(ptr);
    if (t) return t;
  }
  for (const key of Object.keys(event)) {
    if (key === "attributes") continue;
    const t = eventTypeFromAttributesKey(key);
    if (t) return t;
  }
  return "Unknown";
}

const parsed = events.map((e, i) => ({
  eventId: Number(e.eventId) || e.eventId,
  eventType: inferEventType(e),
  attrs: getEventAttrs(e),
}));

const started = parsed.filter((p) => p.eventType === "ActivityTaskStarted").length;
const completed = parsed.filter((p) => p.eventType === "ActivityTaskCompleted").length;
const failed = parsed.filter((p) => p.eventType === "ActivityTaskFailed").length;
const unknown = parsed.filter((p) => p.eventType === "Unknown").length;

console.log("Events:", events.length);
console.log("Parsed ActivityTaskStarted:", started);
console.log("Parsed ActivityTaskCompleted:", completed);
console.log("Parsed ActivityTaskFailed:", failed);
console.log("Parsed Unknown:", unknown);

const gp = parsed.filter((p) =>
  p.attrs.activityType?.name?.includes("GetUserProfile"),
);
console.log(
  "GetUserProfile event types:",
  [...new Set(gp.map((p) => p.eventType))],
);

const cf = parsed.find(
  (p) => p.attrs.continuedFailure?.reason,
)?.attrs.continuedFailure;
if (cf) {
  const details = Buffer.from(cf.details || "", "base64").toString();
  console.log("continuedFailure:", cf.reason, details);
}
