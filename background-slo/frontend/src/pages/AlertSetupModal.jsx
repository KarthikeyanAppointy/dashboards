import { useState, useEffect } from "react";
import { useAuth } from "../auth/AuthContext";
import "./AlertSetupModal.css";

const CONDITION_OPTIONS = [
  { value: "greater_than", label: "Greater than" },
  { value: "less_than", label: "Less than" },
];

const WINDOW_OPTIONS = [
  { value: "5m", label: "5 min" },
  { value: "15m", label: "15 min" },
  { value: "30m", label: "30 min" },
  { value: "1h", label: "1 hour" },
  { value: "6h", label: "6 hours" },
  { value: "24h", label: "24 hours" },
];

const CHANNEL_OPTIONS = [
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
  { value: "slack", label: "Slack" },
];

const SES_REGION_OPTIONS = [
  { value: "", label: "Default (AWS_REGION)" },
  { value: "us-east-1", label: "us-east-1" },
  { value: "us-east-2", label: "us-east-2" },
  { value: "us-west-1", label: "us-west-1" },
  { value: "us-west-2", label: "us-west-2" },
  { value: "eu-west-1", label: "eu-west-1" },
  { value: "eu-west-2", label: "eu-west-2" },
  { value: "eu-central-1", label: "eu-central-1" },
  { value: "ap-southeast-1", label: "ap-southeast-1" },
  { value: "ap-southeast-2", label: "ap-southeast-2" },
  { value: "ap-northeast-1", label: "ap-northeast-1" },
  { value: "sa-east-1", label: "sa-east-1" },
];

const SES_DEFAULT_TEMPLATES = {
  volume:
    "SES Alert: {{metric_value}} in the last hour (threshold: {{threshold}}). Region: {{ses_region}}.",
  failure_rate:
    "SES Rate Alert: {{metric_value}}% in the last hour (threshold: {{threshold}}%). Region: {{ses_region}}.",
};

function windowToSeconds(windowStr) {
  const match = windowStr.match(/^(\d+)([mh])$/);
  if (!match) return 300;
  const val = parseInt(match[1], 10);
  const unit = match[2];
  if (unit === "h") return val * 3600;
  return val * 60;
}

const DEFAULT_METRICS_BY_TILE = {
  "overview-success-rate": [{ value: "success_rate", label: "Success Rate" }],
  "overview-failure-rate": [{ value: "failure_rate", label: "Failure Rate" }],
  "overview-total-volume": [{ value: "volume", label: "Total Volume" }],
  "overview-p100-latency": [{ value: "latency_p100", label: "P100 Latency" }],
  "overview-window": [
    { value: "success_rate", label: "Success Rate" },
    { value: "failure_rate", label: "Failure Rate" },
    { value: "volume", label: "Total Volume" },
    { value: "latency_p100", label: "P100 Latency" },
  ],
  "tasklist-latency": [{ value: "avg_latency_ms", label: "Average Latency" }],
  "recent-failures": [],
  "ses-total-sends": [{ value: "volume", label: "Send Volume" }],
  "ses-bounces": [{ value: "volume", label: "Bounce Count" }],
  "ses-complaints": [{ value: "volume", label: "Complaint Count" }],
  "ses-rejects": [{ value: "volume", label: "Reject Count" }],
  "ses-bounce-rate": [{ value: "failure_rate", label: "Bounce Rate" }],
  "ses-complaint-rate": [{ value: "failure_rate", label: "Complaint Rate" }],
  "ses-error-rate": [{ value: "failure_rate", label: "Error Rate" }],
};

function getTileType(tileId) {
  if (!tileId) return "threshold";
  if (tileId === "recent-failures" || tileId.startsWith("recent-failures-")) {
    return "forward";
  }
  return "threshold";
}

function resolveMetricOptions(tileId) {
  if (!tileId) return [];
  if (tileId.startsWith("overview-window-")) {
    return DEFAULT_METRICS_BY_TILE["overview-window"];
  }
  if (tileId.startsWith("tasklist-latency:")) {
    return DEFAULT_METRICS_BY_TILE["tasklist-latency"];
  }
  return DEFAULT_METRICS_BY_TILE[tileId] ?? [];
}

function AlertSetupModal({
  isOpen,
  onClose,
  tenantId,
  tileId,
  tileLabel,
  existingRule,
  onSaved,
  metricOptions,
}) {
  const { authFetch } = useAuth();

  const alertType = getTileType(tileId);
  const resolvedMetricOptions = metricOptions ?? resolveMetricOptions(tileId);
  const isForwardType = alertType === "forward";

  const [metricType, setMetricType] = useState("");
  const [conditionType, setConditionType] = useState("greater_than");
  const [threshold, setThreshold] = useState("");
  const [window, setWindow] = useState("5m");
  const [notificationChannel, setNotificationChannel] = useState("email");
  const [enabled, setEnabled] = useState(true);
  const [sesRegion, setSesRegion] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    if (existingRule) {
      setMetricType(existingRule.metric_type ?? "");
      setConditionType(existingRule.condition_type ?? "greater_than");
      setThreshold(existingRule.threshold ?? "");
      setWindow(existingRule.window ?? "5m");
      setNotificationChannel(existingRule.notification_channel ?? "email");
      setSesRegion(existingRule.ses_region ?? "");
      setEnabled(existingRule.enabled ?? true);
    } else {
      setMetricType(
        resolvedMetricOptions.length > 0 ? resolvedMetricOptions[0].value : "",
      );
      setConditionType("greater_than");
      setThreshold("");
      setWindow("5m");
      setNotificationChannel("email");
      setEnabled(true);
    }
    setFeedback(null);
  }, [existingRule, isOpen, tileId, resolvedMetricOptions]);

  if (!isOpen) return null;

  const buildQs = (extra) => {
    if (!tenantId) return "";
    const params = new URLSearchParams({ tenant_id: tenantId });
    if (extra) {
      Object.entries(extra).forEach(([k, v]) => {
        if (v !== undefined && v !== null) params.set(k, v);
      });
    }
    return `?${params.toString()}`;
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!tenantId) {
      setFeedback({ type: "error", message: "No tenant selected." });
      return;
    }

    if (!isForwardType && !metricType) {
      setFeedback({ type: "error", message: "Metric type is required." });
      return;
    }

    if (!isForwardType && (!threshold || isNaN(Number(threshold)))) {
      setFeedback({
        type: "error",
        message: "A valid numeric threshold is required.",
      });
      return;
    }

    try {
      setSaving(true);
      setFeedback(null);

      const isSesTile = tileId && tileId.startsWith("ses-");
      const body = {
        name: `Alert: ${tileLabel}`,
        tile_id: tileId,
        alert_type: isForwardType ? "forward" : "threshold",
        metric_type: isForwardType ? "forward_workflow" : metricType,
        notification_channel: notificationChannel,
        notification_target: "",
        enabled,
        ses_region: isSesTile ? sesRegion : "",
        message_template: isSesTile
          ? (SES_DEFAULT_TEMPLATES[metricType] ?? "")
          : "",
      };

      if (!isForwardType) {
        body.condition_type = conditionType;
        body.threshold = Number(threshold);
        body.window_seconds = windowToSeconds(window);
      }

      const url = existingRule
        ? `/api/alerts/rules${buildQs({ id: existingRule.id })}`
        : `/api/alerts/rules${buildQs()}`;
      const method = existingRule ? "PUT" : "POST";

      const res = await authFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.detail ?? `HTTP error ${res.status}`);
      }

      if (onSaved) onSaved();
    } catch (err) {
      setFeedback({ type: "error", message: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="alert-modal-overlay" onClick={onClose}>
      <div className="alert-modal-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="alert-modal-title">Alert: {tileLabel}</h3>

        <form className="alert-modal-body" onSubmit={handleSave}>
          {isForwardType ? (
            <div className="alert-modal-forward-info">
              <p>
                This alert will forward workflow details (type, ID, tasklist,
                status, time) whenever a new failure or timed-out workflow is
                detected.
              </p>
            </div>
          ) : (
            <>
              <div className="alert-modal-row">
                <label className="alert-modal-label">Metric Type</label>
                <select
                  className="alert-modal-select"
                  value={metricType}
                  onChange={(e) => setMetricType(e.target.value)}
                >
                  {resolvedMetricOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="alert-modal-row-inline">
                <div className="alert-modal-row">
                  <label className="alert-modal-label">Condition</label>
                  <select
                    className="alert-modal-select"
                    value={conditionType}
                    onChange={(e) => setConditionType(e.target.value)}
                  >
                    {CONDITION_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="alert-modal-row">
                  <label className="alert-modal-label">Threshold</label>
                  <input
                    type="number"
                    className="alert-modal-input"
                    placeholder="0"
                    step="any"
                    value={threshold}
                    onChange={(e) => setThreshold(e.target.value)}
                  />
                </div>

                <div className="alert-modal-row">
                  <label className="alert-modal-label">Window</label>
                  <select
                    className="alert-modal-select"
                    value={window}
                    onChange={(e) => setWindow(e.target.value)}
                  >
                    {WINDOW_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          )}

          <div className="alert-modal-row">
            <label className="alert-modal-label">Notification Channel</label>
            <select
              className="alert-modal-select"
              value={notificationChannel}
              onChange={(e) => setNotificationChannel(e.target.value)}
            >
              {CHANNEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {tileId && tileId.startsWith("ses-") && (
            <div className="alert-modal-row">
              <label className="alert-modal-label">SES Region</label>
              <select
                className="alert-modal-select"
                value={sesRegion}
                onChange={(e) => setSesRegion(e.target.value)}
              >
                {SES_REGION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="alert-modal-row">
            <label className="alert-modal-checkbox-label">
              <input
                type="checkbox"
                className="alert-modal-checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              <span>Enabled</span>
            </label>
          </div>

          {feedback && (
            <div
              className={`alert-modal-feedback alert-modal-feedback-${feedback.type}`}
            >
              {feedback.message}
            </div>
          )}

          <div className="alert-modal-actions">
            <button
              type="submit"
              className="alert-modal-btn alert-modal-btn-primary"
              disabled={saving}
            >
              {saving
                ? "Saving..."
                : existingRule
                  ? "Update Alert"
                  : "Create Alert"}
            </button>
            <button
              type="button"
              className="alert-modal-btn alert-modal-btn-secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AlertSetupModal;
