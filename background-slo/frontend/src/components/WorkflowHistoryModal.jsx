import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "../auth/AuthContext";
import "./WorkflowHistoryModal.css";

// Cadence EventType enum (shared/event.thrift, iota from 0) + Temporal-compatible IDs
const EVENT_TYPE_BY_ID = {
  0: "WorkflowExecutionStarted",
  1: "WorkflowExecutionCompleted",
  2: "WorkflowExecutionFailed",
  3: "WorkflowExecutionTimedOut",
  4: "DecisionTaskScheduled",
  5: "DecisionTaskStarted",
  6: "DecisionTaskCompleted",
  7: "DecisionTaskTimedOut",
  8: "DecisionTaskFailed",
  9: "ActivityTaskScheduled",
  10: "ActivityTaskStarted",
  11: "ActivityTaskCompleted",
  12: "ActivityTaskFailed",
  13: "ActivityTaskTimedOut",
  14: "ActivityTaskCancelRequested",
  15: "ActivityTaskCanceled",
  16: "TimerStarted",
  17: "TimerFired",
  // Temporal API uses +1 offset for activity events (10–14)
  EVENT_TYPE_ACTIVITY_TASK_SCHEDULED: "ActivityTaskScheduled",
  EVENT_TYPE_ACTIVITY_TASK_STARTED: "ActivityTaskStarted",
  EVENT_TYPE_ACTIVITY_TASK_COMPLETED: "ActivityTaskCompleted",
  EVENT_TYPE_ACTIVITY_TASK_FAILED: "ActivityTaskFailed",
  EVENT_TYPE_ACTIVITY_TASK_TIMED_OUT: "ActivityTaskTimedOut",
};

function unwrapHistoryEvent(event) {
  if (event == null || typeof event !== "object") return event;
  if (event.historyEvent != null) return event.historyEvent;
  if (event.HistoryEvent != null) return event.HistoryEvent;
  return event;
}

function normalizeHistoryEvents(events) {
  if (!Array.isArray(events)) return [];
  return events
    .map((e) => {
      if (e == null) return null;
      if (typeof e === "string") {
        try {
          return unwrapHistoryEvent(JSON.parse(e));
        } catch {
          return null;
        }
      }
      return unwrapHistoryEvent(e);
    })
    .filter(Boolean);
}

function getAttributesPointer(event) {
  const ptr = event.attributes ?? event.Attributes;
  return typeof ptr === "string" ? ptr : null;
}

function getEventAttrs(event) {
  const ptr = getAttributesPointer(event);
  if (ptr && event[ptr] != null) {
    return event[ptr] || {};
  }
  for (const key of Object.keys(event)) {
    if (/EventAttributes$/i.test(key) && key !== "attributes") {
      return event[key] || {};
    }
  }
  return {};
}

function eventTypeFromAttributesKey(key) {
  const match = key.match(/^(.+?)EventAttributes$/i);
  if (!match) return null;
  const base = match[1];
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function inferEventTypeFromAttributes(event) {
  const ptr = getAttributesPointer(event);
  if (ptr) {
    const fromPtr = eventTypeFromAttributesKey(ptr);
    if (fromPtr) return fromPtr;
  }
  for (const key of Object.keys(event)) {
    if (key === "attributes" || key === "Attributes") continue;
    const fromKey = eventTypeFromAttributesKey(key);
    if (fromKey) return fromKey;
  }
  return null;
}

function inferEventType(event) {
  const fromAttrs = inferEventTypeFromAttributes(event);
  if (fromAttrs) return fromAttrs;

  const et = event.eventType ?? event.EventType ?? event.type ?? event.Type;
  if (et == null || et === "") return "Unknown";

  if (typeof et === "number" && EVENT_TYPE_BY_ID[et]) {
    return EVENT_TYPE_BY_ID[et];
  }

  const asNum = parseInt(et, 10);
  if (!Number.isNaN(asNum) && EVENT_TYPE_BY_ID[asNum]) {
    return EVENT_TYPE_BY_ID[asNum];
  }

  if (typeof et === "string") {
    if (EVENT_TYPE_BY_ID[et]) return EVENT_TYPE_BY_ID[et];
    if (Number.isNaN(asNum)) return et;
  }

  return "Unknown";
}

function rawEventImpliesActivityFailure(event) {
  return Object.keys(event).some((key) =>
    /^(local)?activityTaskFailedEventAttributes$/i.test(key),
  ) || Object.keys(event).some((key) =>
    /^(local)?activityTaskTimedOutEventAttributes$/i.test(key),
  );
}

function parseEvent(event, index) {
  const raw = unwrapHistoryEvent(event);
  let eventType = inferEventType(raw);
  if (
    rawEventImpliesActivityFailure(raw) &&
    !isActivityFailureType(eventType)
  ) {
    eventType = inferEventTypeFromAttributes(raw) || "ActivityTaskFailed";
  }
  const eventId = raw.eventId ?? raw.EventID ?? index + 1;
  const attrs = getEventAttrs(raw);
  return {
    eventId: Number(eventId) || eventId,
    eventType,
    attrs,
    raw,
  };
}

function looksLikeBase64(str) {
  if (!str || str.length < 4 || str.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+=*$/.test(str);
}

function decodeBase64Utf8(str) {
  try {
    const binary = atob(str.replace(/\s/g, ""));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** Decode Cadence payloads: base64 data blobs, nested .data, JSON strings */
function decodePayload(value) {
  if (value == null) return null;

  if (Array.isArray(value)) {
    return value.map(decodePayload);
  }

  if (typeof value === "object") {
    if (value.data != null) return decodePayload(value.data);
    if (value.Data != null) return decodePayload(value.Data);
    if (Array.isArray(value.payloads)) {
      return value.payloads.map(decodePayload);
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = decodePayload(v);
    }
    return out;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";

    if (looksLikeBase64(trimmed)) {
      const decoded = decodeBase64Utf8(trimmed);
      if (decoded != null) {
        try {
          return JSON.parse(decoded);
        } catch {
          return decoded;
        }
      }
    }

    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }

  return value;
}

function formatPayload(value) {
  if (value == null) return "";
  const decoded = decodePayload(value);
  if (typeof decoded === "object") {
    return JSON.stringify(decoded, null, 2);
  }
  return String(decoded);
}

function extractFailure(attrs) {
  const failure = attrs.failure || attrs.Failure;
  if (!failure) return null;
  const details = failure.details || failure.Details;
  return {
    message: failure.message || failure.Message || "",
    reason: failure.reason || failure.Reason || "",
    details: details ? formatPayload(details) : "",
    cause: failure.cause || failure.Cause,
  };
}

function extractContinuedFailure(attrs) {
  const cf = attrs.continuedFailure || attrs.ContinuedFailure;
  if (!cf) return null;
  const details = cf.details || cf.Details;
  const decoded = details ? formatPayload(details) : "";
  return {
    reason: cf.reason || cf.Reason || "",
    message: decoded || cf.reason || cf.Reason || "Previous attempt failed",
    details: "",
  };
}

function activityMatchesFailureHint(title, failure) {
  if (!failure || !title) return false;
  const hint = `${failure.reason || ""} ${failure.message || ""}`.toLowerCase();
  const name = title.toLowerCase();
  if (
    (hint.includes("userprofile") || hint.includes("user profile")) &&
    name.includes("userprofile")
  ) {
    return true;
  }
  if (hint.includes("notfound") || hint.includes("not found")) {
    const pathSeg = name.split("/").pop() || name;
    if (pathSeg && hint.includes(pathSeg.toLowerCase())) return true;
  }
  return false;
}

function applyFailureToNode(node, failure, subtitle = "Failed") {
  node.status = "failed";
  node.subtitle = subtitle;
  node.eventType = "ActivityTaskFailed";
  node.failure = failure;
}

function activityTypeName(attrs) {
  return (
    attrs.activityType?.name ||
    attrs.ActivityType?.Name ||
    attrs.activityType?.Name ||
    "Activity"
  );
}

function eventIdValue(id) {
  if (id == null || id === "") return null;
  const n = Number(id);
  return Number.isNaN(n) ? id : n;
}

function scheduledEventId(attrs) {
  return eventIdValue(
    attrs.scheduledEventId ??
      attrs.ScheduledEventId ??
      attrs.scheduled_event_id ??
      attrs.scheduledEventID,
  );
}

function startedEventId(attrs) {
  return eventIdValue(attrs.startedEventId ?? attrs.StartedEventId);
}

/** LocalActivityTask* and ActivityTask* share the same handling */
function normalizeActivityEventType(eventType) {
  return eventType.replace(/^Local/, "");
}

function isActivityFailureType(eventType) {
  const t = normalizeActivityEventType(eventType);
  return (
    t === "ActivityTaskFailed" ||
    t === "ActivityTaskTimedOut" ||
    /ActivityTaskFailed$/i.test(eventType) ||
    /ActivityTaskTimedOut$/i.test(eventType)
  );
}

function isActivityFailureOutcome(status) {
  return status === "failed" || status === "timeout";
}

function applyActivityFailureState(node, evt) {
  const { attrs, raw, eventType: rawType } = evt;
  const timedOut =
    normalizeActivityEventType(rawType) === "ActivityTaskTimedOut" ||
    /TimedOut$/i.test(rawType);

  node.status = timedOut ? "timeout" : "failed";
  node.subtitle = timedOut ? "Timed Out" : "Failed";
  node.eventType = rawType;
  node.raw = raw;
  node.relatedEvents = node.relatedEvents || [];
  node.relatedEvents.push(raw);

  if (timedOut) {
    node.failure = {
      message: "Activity timed out",
      reason: attrs.timeoutType || attrs.TimeoutType || "",
      details: "",
    };
  } else {
    node.failure = extractFailure(attrs) || {
      message: attrs.reason || attrs.Reason || "Activity failed",
      reason: "",
      details: formatPayload(attrs.details || attrs.Details),
    };
    node.output = formatPayload(attrs.details || attrs.Details);
  }
}

function createActivityNode(nodeId, eventId, attrs, raw) {
  return {
    id: nodeId,
    kind: "activity",
    scheduledEventId: eventId,
    title: activityTypeName(attrs),
    subtitle: "Scheduled",
    status: "pending",
    eventType: "ActivityTaskScheduled",
    input: formatPayload(attrs.input || attrs.Input),
    output: null,
    failure: null,
    raw,
    relatedEvents: [raw],
  };
}

function createWorkflowStartNode(attrs, raw, id = "workflow-start") {
  const continuedFailure = extractContinuedFailure(attrs);
  const workflowName =
    attrs.workflowType?.name ||
    attrs.WorkflowType?.Name ||
    attrs.workflowType?.Name ||
    "Workflow";
  return {
    id,
    kind: "workflow",
    title: continuedFailure ? "Workflow Retry" : "Workflow Started",
    subtitle: continuedFailure ? "After previous failure" : workflowName,
    status: continuedFailure ? "failed" : "neutral",
    eventType: "WorkflowExecutionStarted",
    input: formatPayload(attrs.input || attrs.Input),
    output: null,
    failure: continuedFailure,
    raw,
    relatedEvents: [raw],
  };
}

function createWorkflowEndNode(eventType, attrs, raw) {
  const failed = eventType === "WorkflowExecutionFailed";
  const timedOut = eventType === "WorkflowExecutionTimedOut";
  return {
    id: "workflow-end",
    kind: "workflow",
    title: failed
      ? "Workflow Failed"
      : timedOut
        ? "Workflow Timed Out"
        : "Workflow Completed",
    subtitle: failed ? "Execution failed" : timedOut ? "Timed out" : "Success",
    status: failed ? "failed" : timedOut ? "timeout" : "success",
    eventType,
    input: null,
    output: formatPayload(attrs.result || attrs.Result),
    failure: failed || timedOut ? extractFailure(attrs) : null,
    raw,
    relatedEvents: [raw],
  };
}

function createOrphanActivityNode(attrs, raw, eventId, eventType, status, subtitle) {
  const schedId = scheduledEventId(attrs);
  const nodeId =
    schedId != null ? `activity-${schedId}` : `activity-orphan-${eventId}`;
  return {
    id: nodeId,
    kind: "activity",
    scheduledEventId: schedId ?? eventId,
    title: activityTypeName(attrs),
    subtitle,
    status,
    eventType,
    input: formatPayload(attrs.input || attrs.Input),
    output: formatPayload(attrs.result || attrs.Result || attrs.details || attrs.Details),
    failure:
      status === "failed" || status === "timeout"
        ? extractFailure(attrs) || {
            message: attrs.reason || attrs.Reason || subtitle,
            reason: "",
            details: formatPayload(attrs.details || attrs.Details),
          }
        : null,
    raw,
    relatedEvents: [raw],
  };
}

function finalizeOpenActivities(nodes, syncNodeInItems, failure) {
  const fallback = failure || {
    reason: "",
    message: "Workflow ended before this activity finished",
    details: "",
  };
  for (const node of nodes) {
    if (
      node.kind === "activity" &&
      (node.status === "pending" || node.status === "running")
    ) {
      applyFailureToNode(node, fallback);
      syncNodeInItems(node);
    }
  }
}

function applyContinuedFailureToPriorSegment(
  nodes,
  syncNodeInItems,
  failure,
  priorSegment,
) {
  if (!failure || priorSegment < 0) return;
  const prefix = `activity-s${priorSegment}-`;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    if (node.kind !== "activity" || !node.id.startsWith(prefix)) continue;
    if (!activityMatchesFailureHint(node.title, failure)) continue;
    applyFailureToNode(
      node,
      failure,
      node.status === "success" ? "Failed (prior attempt)" : "Failed",
    );
    syncNodeInItems(node);
    return;
  }
}

function buildWorkflowGraph(events, options = {}) {
  const workflowFailed =
    options.workflowFailed === true ||
    /fail/i.test(String(options.workflowStatus || ""));

  const parsed = normalizeHistoryEvents(events).map(parseEvent);
  const activityByKey = new Map();
  const items = [];
  const nodes = [];
  const seenNodeIds = new Set();
  let pendingDecisionEdge = false;
  let pendingDecisionLabel = "Decision";
  let segmentIndex = 0;
  let workflowStartCount = 0;
  let lastContinuedFailure = null;
  let lastOpenActivity = null;

  const activityNodeId = (eventId) => `activity-s${segmentIndex}-${eventId}`;

  const beginNewSegment = () => {
    if (workflowFailed || lastContinuedFailure) {
      finalizeOpenActivities(nodes, syncNodeInItems, lastContinuedFailure);
    }
    segmentIndex++;
    activityByKey.clear();
    lastOpenActivity = null;
  };

  const lookupActivity = (...ids) => {
    for (const id of ids) {
      if (id == null) continue;
      const node =
        activityByKey.get(id) ??
        activityByKey.get(String(id)) ??
        activityByKey.get(Number(id));
      if (node) return node;
    }
    return null;
  };

  const registerActivityKeys = (node, ...ids) => {
    for (const id of ids) {
      if (id == null) continue;
      activityByKey.set(id, node);
      activityByKey.set(String(id), node);
      activityByKey.set(Number(id), node);
    }
  };

  const flushDecisionEdge = () => {
    if (!pendingDecisionEdge) return;
    const last = items[items.length - 1];
    if (last?.type === "decision") {
      pendingDecisionEdge = false;
      return;
    }
    items.push({
      type: "decision",
      id: `decision-${items.length}`,
      label: pendingDecisionLabel,
    });
    pendingDecisionEdge = false;
  };

  const syncNodeInItems = (node) => {
    for (const item of items) {
      if (item.type === "node" && item.id === node.id) {
        item.data = node;
        break;
      }
    }
  };

  const pushNode = (node) => {
    if (seenNodeIds.has(node.id)) return;
    flushDecisionEdge();
    seenNodeIds.add(node.id);
    items.push({ type: "node", id: node.id, data: node });
    nodes.push(node);
  };

  const upsertActivityNode = (node) => {
    if (seenNodeIds.has(node.id)) {
      syncNodeInItems(node);
      return;
    }
    pushNode(node);
  };

  const findActivityNode = (attrs, lastOpenActivity) => {
    const schedId = scheduledEventId(attrs);
    const startId = startedEventId(attrs);

    let node = lookupActivity(schedId, startId);
    if (node) return node;

    if (schedId != null) {
      const nodeId = activityNodeId(schedId);
      node = nodes.find(
        (n) =>
          n.kind === "activity" &&
          (n.id === nodeId ||
            n.id === `activity-${schedId}` ||
            String(n.scheduledEventId) === String(schedId) ||
            n.scheduledEventId === schedId),
      );
      if (node) return node;
    }

    if (
      lastOpenActivity &&
      (lastOpenActivity.status === "pending" ||
        lastOpenActivity.status === "running")
    ) {
      return lastOpenActivity;
    }

    return null;
  };

  for (const evt of parsed) {
    const { eventType: rawType, attrs, eventId, raw } = evt;
    const eventType = normalizeActivityEventType(rawType);

    if (rawType.startsWith("DecisionTask")) {
      if (rawType === "DecisionTaskCompleted") {
        pendingDecisionEdge = true;
        pendingDecisionLabel = "Decision";
      }
      continue;
    }

    if (rawType === "TimerFired") {
      pendingDecisionEdge = true;
      pendingDecisionLabel = "Timer";
      continue;
    }

    if (rawType === "TimerStarted") {
      continue;
    }

    if (eventType === "WorkflowExecutionStarted") {
      if (workflowStartCount > 0) {
        beginNewSegment();
      }
      workflowStartCount++;
      const continuedFailure = extractContinuedFailure(attrs);
      if (continuedFailure) {
        lastContinuedFailure = continuedFailure;
      }
      const startId =
        workflowStartCount === 1 ? "workflow-start" : `workflow-start-${segmentIndex}`;
      if (!seenNodeIds.has(startId)) {
        pushNode(createWorkflowStartNode(attrs, raw, startId));
      }
      if (continuedFailure && segmentIndex > 0) {
        applyContinuedFailureToPriorSegment(
          nodes,
          syncNodeInItems,
          continuedFailure,
          segmentIndex - 1,
        );
      }
      continue;
    }

    if (
      eventType === "WorkflowExecutionCompleted" ||
      eventType === "WorkflowExecutionFailed" ||
      eventType === "WorkflowExecutionTimedOut"
    ) {
      pendingDecisionEdge = false;
      const endNode = createWorkflowEndNode(eventType, attrs, raw);
      const existingIdx = items.findIndex(
        (i) => i.type === "node" && i.id === "workflow-end",
      );
      if (existingIdx >= 0) {
        items[existingIdx] = { type: "node", id: "workflow-end", data: endNode };
        const nodeIdx = nodes.findIndex((n) => n.id === "workflow-end");
        if (nodeIdx >= 0) nodes[nodeIdx] = endNode;
      } else {
        pushNode(endNode);
      }
      continue;
    }

    if (eventType === "ActivityTaskScheduled") {
      const nodeId = activityNodeId(eventId);
      if (!seenNodeIds.has(nodeId)) {
        const node = createActivityNode(nodeId, eventId, attrs, raw);
        registerActivityKeys(node, eventId, scheduledEventId(attrs));
        pushNode(node);
        lastOpenActivity = node;
      } else {
        const existing = lookupActivity(eventId, scheduledEventId(attrs));
        if (existing) lastOpenActivity = existing;
      }
      continue;
    }

    if (eventType === "ActivityTaskStarted") {
      const schedId = scheduledEventId(attrs);
      let node = findActivityNode(attrs, lastOpenActivity);
      if (node) {
        if (node.status === "pending") {
          node.subtitle = "Running";
          node.status = "running";
        }
        node.relatedEvents.push(raw);
        registerActivityKeys(node, schedId, eventId, startedEventId(attrs));
        lastOpenActivity = node;
        syncNodeInItems(node);
      }
      continue;
    }

    if (isActivityFailureType(rawType) || rawEventImpliesActivityFailure(raw)) {
      let node = findActivityNode(attrs, lastOpenActivity);
      if (!node) {
        const schedId = scheduledEventId(attrs);
        const evtIdx = parsed.indexOf(evt);
        for (let i = evtIdx - 1; i >= 0; i--) {
          const prev = parsed[i];
          if (normalizeActivityEventType(prev.eventType) === "ActivityTaskScheduled") {
            const prevId = activityNodeId(prev.eventId);
            node = nodes.find(
              (n) => n.id === prevId || n.id === `activity-${prev.eventId}`,
            );
            if (node) break;
          }
        }
      }
      if (node) {
        applyActivityFailureState(node, evt);
        syncNodeInItems(node);
        lastOpenActivity = null;
      } else {
        const orphan = createOrphanActivityNode(
          attrs,
          raw,
          eventId,
          rawType,
          /TimedOut$/i.test(rawType) ? "timeout" : "failed",
          /TimedOut$/i.test(rawType) ? "Timed Out" : "Failed",
        );
        registerActivityKeys(
          orphan,
          scheduledEventId(attrs),
          startedEventId(attrs),
          orphan.scheduledEventId,
        );
        upsertActivityNode(orphan);
        lastOpenActivity = null;
      }
      continue;
    }

    if (eventType === "ActivityTaskCompleted") {
      const node = findActivityNode(attrs, lastOpenActivity);
      if (node) {
        node.subtitle = "Completed";
        node.status = "success";
        node.output = formatPayload(attrs.result || attrs.Result);
        node.eventType = rawType;
        node.relatedEvents.push(raw);
        node.raw = raw;
        syncNodeInItems(node);
      }
      lastOpenActivity = null;
      continue;
    }

    if (eventType === "ActivityTaskCancelRequested") {
      const node = findActivityNode(attrs, lastOpenActivity);
      if (node) {
        node.subtitle = "Cancel requested";
        node.status = "timeout";
        node.relatedEvents.push(raw);
      }
      lastOpenActivity = null;
    }
  }

  // Second pass: ensure every failure event updated its activity node
  for (const evt of parsed) {
    if (
      !isActivityFailureType(evt.eventType) &&
      !rawEventImpliesActivityFailure(evt.raw)
    ) {
      continue;
    }
    const schedId = scheduledEventId(evt.attrs);
    let node =
      schedId != null
        ? nodes.find(
            (n) =>
              n.kind === "activity" &&
              (n.id === activityNodeId(schedId) ||
                n.id === `activity-${schedId}` ||
                String(n.scheduledEventId) === String(schedId)),
          )
        : null;
    if (!node) {
      const evtIdx = parsed.indexOf(evt);
      for (let i = evtIdx - 1; i >= 0; i--) {
        const prev = parsed[i];
        if (normalizeActivityEventType(prev.eventType) === "ActivityTaskScheduled") {
          node = nodes.find(
            (n) =>
              n.id === activityNodeId(prev.eventId) ||
              n.id === `activity-${prev.eventId}`,
          );
          if (node) break;
        }
      }
    }
    if (node && !isActivityFailureOutcome(node.status)) {
      applyActivityFailureState(node, evt);
      syncNodeInItems(node);
    }
  }

  if (workflowFailed || lastContinuedFailure) {
    finalizeOpenActivities(nodes, syncNodeInItems, lastContinuedFailure);
  }

  pendingDecisionEdge = false;

  while (items.length > 0 && items[items.length - 1].type === "decision") {
    items.pop();
  }
  while (items.length > 0 && items[0].type === "decision") {
    items.shift();
  }

  const compacted = [];
  for (const item of items) {
    if (
      item.type === "decision" &&
      compacted[compacted.length - 1]?.type === "decision"
    ) {
      continue;
    }
    compacted.push(item);
  }

  const finalNodes = compacted
    .filter((i) => i.type === "node")
    .map((i) => i.data);

  if (finalNodes.length === 0 && parsed.length > 0) {
    for (const evt of parsed) {
      if (evt.eventType.startsWith("DecisionTask")) continue;
      if (evt.eventType === "TimerStarted" || evt.eventType === "TimerFired") {
        continue;
      }
      const id = `event-${evt.eventId}`;
      if (seenNodeIds.has(id)) continue;
      const isFail =
        evt.eventType.includes("Failed") || evt.eventType.includes("TimedOut");
      pushNode({
        id,
        kind: "activity",
        title: evt.eventType.replace(/([A-Z])/g, " $1").trim(),
        subtitle: "Event",
        status: isFail
          ? evt.eventType.includes("TimedOut")
            ? "timeout"
            : "failed"
          : "neutral",
        eventType: evt.eventType,
        input: formatPayload(
          evt.attrs.input || evt.attrs.Input || evt.attrs.details,
        ),
        output: null,
        failure: extractFailure(evt.attrs),
        raw: evt.raw,
        relatedEvents: [evt.raw],
      });
    }
  }

  return {
    nodes: compacted.filter((i) => i.type === "node").map((i) => i.data),
    items: compacted,
    parsed,
  };
}

function workflowStatusClass(status) {
  const s = (status || "").toLowerCase();
  if (s === "failed") return "status-failed";
  if (s === "timedout" || s === "timed out") return "status-timedout";
  return "status-default";
}

function NodeStatusDot({ status }) {
  return <span className={`wf-node-dot wf-node-dot-${status}`} aria-hidden="true" />;
}

function WorkflowGraph({ items, selectedNode, onSelectNode }) {
  if (items.length === 0) {
    return <p className="wf-empty">No steps to display in this history.</p>;
  }

  return (
    <div className="wf-timeline">
      {items.map((item, index) => (
        <div key={item.id} className="wf-timeline-step">
          {index > 0 && <div className="wf-timeline-line" aria-hidden="true" />}
          {item.type === "decision" ? (
            <div className="wf-decision-edge">
              <span className="wf-decision-edge-label">{item.label}</span>
            </div>
          ) : (
            <button
              type="button"
              className={`wf-node wf-node-${item.data.status}${
                selectedNode?.id === item.data.id ? " wf-node-selected" : ""
              }`}
              onClick={() => onSelectNode(item.data)}
            >
              <NodeStatusDot status={item.data.status} />
              <div className="wf-node-text">
                <span className="wf-node-title">{item.data.title}</span>
                <span className="wf-node-subtitle">{item.data.subtitle}</span>
              </div>
              {(item.data.status === "failed" || item.data.status === "timeout") && (
                <span
                  className={`status-badge ${item.data.status === "failed" ? "status-failed" : "status-timedout"}`}
                >
                  {item.data.status === "timeout" ? "Timed Out" : "Failed"}
                </span>
              )}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function WorkflowHistoryModal({ workflow, tenantId, onClose }) {
  const { authFetch } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [graph, setGraph] = useState({ nodes: [], items: [] });
  const [selectedNode, setSelectedNode] = useState(null);
  const [rawEvents, setRawEvents] = useState([]);
  const fetchGen = useRef(0);

  const fetchHistory = useCallback(
    async (signal) => {
      if (!tenantId || !workflow) return;
      const gen = ++fetchGen.current;
      setLoading(true);
      setError(null);
      const timeoutId = setTimeout(() => {
        if (!signal.aborted) signal.abort();
      }, 95000);

      try {
        const params = new URLSearchParams({
          tenant_id: String(tenantId),
          workflow_id: workflow.workflow_id,
          run_id: workflow.run_id,
        });
        const url = `/api/workflows/history?${params}`;
        const res = await authFetch(url, { signal });
        if (!res.ok) {
          const raw = await res.text();
          let message = `HTTP ${res.status}`;
          try {
            message = JSON.parse(raw)?.error || message;
          } catch {
            if (raw) message = raw;
          }
          throw new Error(message);
        }
        const data = await res.json();
        if (gen !== fetchGen.current || signal.aborted) return;

        const events = normalizeHistoryEvents(data.events);
        const built = buildWorkflowGraph(events, {
          workflowStatus: workflow.status,
          workflowFailed:
            /fail/i.test(String(workflow.status || "")) ||
            /timed?\s*out/i.test(String(workflow.status || "")),
        });
        setRawEvents(events);
        setGraph(built);

        const failedNode =
          built.nodes.find((n) => n.status === "failed" || n.status === "timeout") ||
          built.nodes.find((n) => n.failure);
        setSelectedNode(failedNode || built.nodes[built.nodes.length - 1] || null);
      } catch (err) {
        if (gen !== fetchGen.current || signal.aborted) return;
        if (err.name === "AbortError") {
          setError(
            "Request timed out. Check that Cadence Web URL is reachable from the dashboard backend.",
          );
        } else {
          setError(err.message || "Failed to load workflow history");
        }
      } finally {
        clearTimeout(timeoutId);
        if (gen === fetchGen.current) setLoading(false);
      }
    },
    [authFetch, tenantId, workflow],
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchHistory(controller.signal);
    return () => {
      controller.abort();
      fetchGen.current += 1;
    };
  }, [fetchHistory]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rootFailure = graph.nodes.find(
    (n) =>
      n.eventType === "WorkflowExecutionFailed" ||
      n.eventType === "WorkflowExecutionTimedOut" ||
      (n.kind === "workflow" && n.failure),
  );

  return (
    <div className="wf-modal-overlay" onClick={onClose}>
      <div className="wf-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="wf-modal-header">
          <div>
            <h2 className="wf-modal-title">Workflow Execution</h2>
            <p className="wf-modal-desc">
              <span className="wf-modal-type">{workflow.workflow_type}</span>
              <span className={`status-badge ${workflowStatusClass(workflow.status)}`}>
                {workflow.status}
              </span>
            </p>
            <p className="wf-modal-ids">
              <span title={workflow.workflow_id}>{workflow.workflow_id}</span>
              <span className="wf-modal-sep">·</span>
              <span title={workflow.run_id}>{workflow.run_id}</span>
            </p>
          </div>
          <button type="button" className="wf-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {loading && (
          <div className="wf-modal-state">
            <div className="wf-spinner" />
            <p>Loading workflow history…</p>
          </div>
        )}

        {error && !loading && (
          <div className="wf-modal-state wf-modal-error">
            <p>{error}</p>
            <button type="button" className="wf-btn-secondary" onClick={() => fetchHistory(new AbortController().signal)}>
              Retry
            </button>
          </div>
        )}

        {!loading && !error && (
          <>
            {rootFailure?.failure && (
              <div className={`wf-alert-banner ${rootFailure.status === "failed" ? "wf-alert-failed" : "wf-alert-timeout"}`}>
                <h3 className="wf-alert-title">Why it failed</h3>
                {rootFailure.failure.reason && (
                  <p className="wf-alert-reason">{rootFailure.failure.reason}</p>
                )}
                {rootFailure.failure.message && (
                  <p className="wf-alert-message">{rootFailure.failure.message}</p>
                )}
                {rootFailure.failure.details && (
                  <pre className="wf-code-block">{rootFailure.failure.details}</pre>
                )}
              </div>
            )}

            <div className="wf-modal-body">
              <section className="wf-timeline-panel">
                <h3 className="wf-panel-label">Timeline</h3>
                <WorkflowGraph
                  items={graph.items}
                  selectedNode={selectedNode}
                  onSelectNode={setSelectedNode}
                />
              </section>

              <aside className="wf-detail-panel">
                <h3 className="wf-panel-label">Details</h3>
                {selectedNode ? (
                  <div className="wf-detail-content">
                    <h4 className="wf-detail-heading">{selectedNode.title}</h4>
                    <p className="wf-detail-meta">
                      <span
                        className={`status-badge ${
                          selectedNode.status === "failed"
                            ? "status-failed"
                            : selectedNode.status === "timeout"
                              ? "status-timedout"
                              : ""
                        }`}
                      >
                        {selectedNode.subtitle}
                      </span>
                    </p>

                    {selectedNode.failure && (
                      <div className={`wf-detail-block ${selectedNode.status === "failed" ? "wf-detail-block-failed" : "wf-detail-block-timeout"}`}>
                        <h5>Failure</h5>
                        {selectedNode.failure.reason && (
                          <p>
                            <strong>Reason:</strong> {selectedNode.failure.reason}
                          </p>
                        )}
                        {selectedNode.failure.message && (
                          <p>
                            <strong>Message:</strong> {selectedNode.failure.message}
                          </p>
                        )}
                        {selectedNode.failure.details && (
                          <pre className="wf-code-block">{selectedNode.failure.details}</pre>
                        )}
                      </div>
                    )}

                    {selectedNode.input && (
                      <div className="wf-detail-block">
                        <h5>Input</h5>
                        <pre className="wf-code-block">{selectedNode.input}</pre>
                      </div>
                    )}

                    {selectedNode.output && (
                      <div className="wf-detail-block">
                        <h5>Output</h5>
                        <pre className="wf-code-block">{selectedNode.output}</pre>
                      </div>
                    )}

                    {!selectedNode.input &&
                      !selectedNode.output &&
                      !selectedNode.failure && (
                        <p className="wf-detail-empty">No input or output for this step.</p>
                      )}

                    <details className="wf-raw-toggle">
                      <summary>Raw event</summary>
                      <pre className="wf-code-block">
                        {JSON.stringify(selectedNode.raw, null, 2)}
                      </pre>
                    </details>
                  </div>
                ) : (
                  <p className="wf-detail-empty">Select a step to view details.</p>
                )}
              </aside>
            </div>

            <footer className="wf-modal-footer">
              {rawEvents.length} events · {graph.nodes.length} steps
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

export default WorkflowHistoryModal;
export { buildWorkflowGraph, normalizeHistoryEvents, parseEvent };
