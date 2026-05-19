import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../auth/AuthContext";
import "./AlertsPage.css";

/* ─── Metric type labels ────────────────────────────────────── */
const METRIC_OPTIONS = [
  { value: "failure_rate", label: "Failure Rate" },
  { value: "latency_p100", label: "P100 Latency" },
  { value: "activity_error_rate", label: "Activity Error Rate" },
  // ── SES Metrics ─────────────────────────────────────
  { value: "ses_send_volume", label: "SES Send Volume" },
  { value: "ses_bounce_count", label: "SES Bounce Count" },
  { value: "ses_complaint_count", label: "SES Complaint Count" },
  { value: "ses_bounce_rate", label: "SES Bounce Rate" },
  { value: "ses_complaint_rate", label: "SES Complaint Rate" },
  { value: "ses_error_rate", label: "SES Error Rate" },
];

const CONDITION_OPTIONS = [
  { value: "greater_than", label: "Greater Than" },
  { value: "less_than", label: "Less Than" },
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
  { value: "slack", label: "Slack" },
  { value: "webhook", label: "Webhook" },
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
  ses_bounce_rate:
    "SES Bounce Rate Alert: {{metric_value}}% in the last hour (threshold: {{threshold}}%). High bounce rates may impact sender reputation. Review your email list and remove invalid addresses.",
  ses_complaint_rate:
    "SES Complaint Rate Alert: {{metric_value}}% in the last hour (threshold: {{threshold}}%). High complaint rates can lead to account suspension. Review your email content and sending practices.",
  ses_error_rate:
    "SES Error Rate Alert: {{metric_value}}% combined error rate in the last hour (threshold: {{threshold}}%). This includes bounces and complaints. Immediate attention required.",
  ses_send_volume:
    "SES Send Volume Alert: {{metric_value}} sends in the last hour (threshold: {{threshold}}). Unusual send volume detected. Verify no unauthorized sending activity.",
  ses_bounce_count:
    "SES Bounce Alert: {{metric_value}} bounces in the last hour (threshold: {{threshold}}). High bounce count detected in region {{ses_region}}.",
  ses_complaint_count:
    "SES Complaint Alert: {{metric_value}} complaints in the last hour (threshold: {{threshold}}). High complaint count detected in region {{ses_region}}.",
};

const EMPTY_RULE = {
  name: "",
  metric_type: "failure_rate",
  condition_type: "greater_than",
  threshold: "",
  window: "5m",
  notification_channel: "email",
  notification_target: "",
  enabled: true,
  ses_region: "",
};

const TARGET_PLACEHOLDERS = {
  email: "alerts@example.com",
  slack: "https://hooks.slack.com/services/...",
  webhook: "https://hooks.example.com/alerts",
};

function AlertsPage({ selectedTenantId }) {
  const { authFetch } = useAuth();

  /* ─── NotifyHub config state ────────────────────────────────── */
  const [config, setConfig] = useState({
    notifyhub_url: "",
    notifyhub_api_key: "",
  });
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [configFeedback, setConfigFeedback] = useState(null);
  const [showApiKey, setShowApiKey] = useState(false);

  /* ─── Alert rules state ─────────────────────────────────────── */
  const [rules, setRules] = useState([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [rulesError, setRulesError] = useState(null);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [ruleForm, setRuleForm] = useState({ ...EMPTY_RULE });
  const [ruleSaving, setRuleSaving] = useState(false);
  const [ruleFeedback, setRuleFeedback] = useState(null);

  /* ─── Test dialog state ─────────────────────────────────────── */
  const [testRuleId, setTestRuleId] = useState(null);
  const [testMessage, setTestMessage] = useState("");
  const [testSending, setTestSending] = useState(false);
  const [testFeedback, setTestFeedback] = useState(null);

  /* ─── Helper: build query string ────────────────────────────── */
  const qs = useCallback(
    (extra) => {
      if (!selectedTenantId) return "";
      const params = new URLSearchParams({ tenant_id: selectedTenantId });
      if (extra) {
        Object.entries(extra).forEach(([k, v]) => {
          if (v !== undefined && v !== null) params.set(k, v);
        });
      }
      return `?${params.toString()}`;
    },
    [selectedTenantId],
  );

  /* ─── Fetch config ──────────────────────────────────────────── */
  const fetchConfig = useCallback(async () => {
    if (!selectedTenantId) return;
    try {
      setConfigLoading(true);
      const res = await authFetch(`/api/alerts/config${qs()}`);
      if (res.ok) {
        const json = await res.json();
        setConfig({
          notifyhub_url: json.notifyhub_url ?? "",
          notifyhub_api_key: json.notifyhub_api_key ?? "",
        });
      }
    } catch {
      // ignore – defaults will be shown
    } finally {
      setConfigLoading(false);
    }
  }, [authFetch, qs, selectedTenantId]);

  /* ─── Save config ───────────────────────────────────────────── */
  const handleSaveConfig = async (e) => {
    e.preventDefault();
    if (!selectedTenantId) {
      setConfigFeedback({
        type: "error",
        message: "Please select a tenant first.",
      });
      return;
    }
    if (!config.notifyhub_url.trim()) {
      setConfigFeedback({
        type: "error",
        message: "NotifyHub URL is required.",
      });
      return;
    }
    try {
      setConfigSaving(true);
      setConfigFeedback(null);
      const res = await authFetch(`/api/alerts/config${qs()}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notifyhub_url: config.notifyhub_url.trim(),
          notifyhub_api_key: config.notifyhub_api_key,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.detail ?? `HTTP error ${res.status}`);
      }
      setConfigFeedback({
        type: "success",
        message: "NotifyHub configuration saved.",
      });
    } catch (err) {
      setConfigFeedback({ type: "error", message: err.message });
    } finally {
      setConfigSaving(false);
    }
  };

  /* ─── Fetch rules ───────────────────────────────────────────── */
  const fetchRules = useCallback(async () => {
    if (!selectedTenantId) {
      setRules([]);
      return;
    }
    try {
      setRulesLoading(true);
      setRulesError(null);
      const res = await authFetch(`/api/alerts/rules${qs()}`);
      if (!res.ok) {
        throw new Error(`HTTP error ${res.status}`);
      }
      const json = await res.json();
      setRules(Array.isArray(json) ? json : (json.rules ?? []));
    } catch (err) {
      setRulesError(err.message);
    } finally {
      setRulesLoading(false);
    }
  }, [authFetch, qs, selectedTenantId]);

  /* ─── Load on tenant change ─────────────────────────────────── */
  useEffect(() => {
    fetchConfig();
    fetchRules();
  }, [fetchConfig, fetchRules]);

  /* ─── Open create form ──────────────────────────────────────── */
  const openCreateForm = () => {
    setEditingRuleId(null);
    setRuleForm({ ...EMPTY_RULE });
    setRuleFeedback(null);
    setShowRuleForm(true);
  };

  /* ─── Open edit form ────────────────────────────────────────── */
  const openEditForm = (rule) => {
    setEditingRuleId(rule.id);
    setRuleForm({
      name: rule.name ?? "",
      metric_type: rule.metric_type ?? "failure_rate",
      condition_type: rule.condition_type ?? "greater_than",
      threshold: rule.threshold ?? "",
      window: rule.window ?? "5m",
      notification_channel: rule.notification_channel ?? "email",
      notification_target: rule.notification_target ?? "",
      enabled: rule.enabled ?? true,
      ses_region: rule.ses_region ?? "",
    });
    setRuleFeedback(null);
    setShowRuleForm(true);
  };

  /* ─── Cancel form ───────────────────────────────────────────── */
  const cancelForm = () => {
    setShowRuleForm(false);
    setEditingRuleId(null);
    setRuleForm({ ...EMPTY_RULE });
    setRuleFeedback(null);
  };

  /* ─── Save rule (create or update) ──────────────────────────── */
  const handleSaveRule = async (e) => {
    e.preventDefault();
    if (!selectedTenantId) {
      setRuleFeedback({
        type: "error",
        message: "Please select a tenant first.",
      });
      return;
    }
    if (!ruleForm.name.trim()) {
      setRuleFeedback({ type: "error", message: "Rule name is required." });
      return;
    }
    if (!ruleForm.threshold || isNaN(Number(ruleForm.threshold))) {
      setRuleFeedback({
        type: "error",
        message: "A valid numeric threshold is required.",
      });
      return;
    }
    if (!ruleForm.notification_target.trim()) {
      setRuleFeedback({
        type: "error",
        message: "Notification target is required.",
      });
      return;
    }

    try {
      setRuleSaving(true);
      setRuleFeedback(null);

      const body = {
        name: ruleForm.name.trim(),
        metric_type: ruleForm.metric_type,
        condition_type: ruleForm.condition_type,
        threshold: Number(ruleForm.threshold),
        window: ruleForm.window,
        notification_channel: ruleForm.notification_channel,
        notification_target: ruleForm.notification_target.trim(),
        enabled: ruleForm.enabled,
        ses_region: ruleForm.metric_type.startsWith("ses_")
          ? ruleForm.ses_region
          : "",
        message_template: ruleForm.metric_type.startsWith("ses_")
          ? (SES_DEFAULT_TEMPLATES[ruleForm.metric_type] ?? "")
          : "",
      };

      let url;
      let method;
      if (editingRuleId) {
        url = `/api/alerts/rules${qs({ id: editingRuleId })}`;
        method = "PUT";
      } else {
        url = `/api/alerts/rules${qs()}`;
        method = "POST";
      }

      const res = await authFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.detail ?? `HTTP error ${res.status}`);
      }

      setRuleFeedback({
        type: "success",
        message: editingRuleId
          ? "Rule updated successfully."
          : "Rule created successfully.",
      });
      cancelForm();
      fetchRules();
    } catch (err) {
      setRuleFeedback({ type: "error", message: err.message });
    } finally {
      setRuleSaving(false);
    }
  };

  /* ─── Delete rule ───────────────────────────────────────────── */
  const handleDeleteRule = async (ruleId) => {
    if (!selectedTenantId) return;
    if (!window.confirm("Are you sure you want to delete this alert rule?"))
      return;

    try {
      const res = await authFetch(`/api/alerts/rules${qs({ id: ruleId })}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.detail ?? `HTTP error ${res.status}`);
      }
      fetchRules();
    } catch (err) {
      setRulesError(err.message);
    }
  };

  /* ─── Test rule ─────────────────────────────────────────────── */
  const openTestDialog = (ruleId) => {
    setTestRuleId(ruleId);
    setTestMessage("");
    setTestFeedback(null);
  };

  const closeTestDialog = () => {
    setTestRuleId(null);
    setTestMessage("");
    setTestFeedback(null);
  };

  const handleTestRule = async (e) => {
    e.preventDefault();
    if (!selectedTenantId) {
      setTestFeedback({
        type: "error",
        message: "Please select a tenant first.",
      });
      return;
    }
    if (!testMessage.trim()) {
      setTestFeedback({ type: "error", message: "Test message is required." });
      return;
    }

    try {
      setTestSending(true);
      setTestFeedback(null);
      const res = await authFetch(`/api/alerts/rules/test${qs()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rule_id: testRuleId,
          message: testMessage.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.detail ?? `HTTP error ${res.status}`);
      }
      setTestFeedback({
        type: "success",
        message: "Test notification sent successfully.",
      });
    } catch (err) {
      setTestFeedback({ type: "error", message: err.message });
    } finally {
      setTestSending(false);
    }
  };

  /* ─── Render ────────────────────────────────────────────────── */
  return (
    <div className="alerts-page">
      {/* ────────────── NOTIFYHUB CONNECTION ──────────────────── */}
      <section className="alerts-section card-surface">
        <div className="section-header">
          <div>
            <h2 className="section-title">NotifyHub Connection</h2>
            <p className="section-subtitle">
              Configure your NotifyHub instance to send alert notifications.
            </p>
          </div>
        </div>

        <form className="alerts-config-form" onSubmit={handleSaveConfig}>
          {configLoading ? (
            <div className="alerts-loading-inline">
              <div className="spinner" />
              <span>Loading configuration...</span>
            </div>
          ) : (
            <>
              <div className="alerts-form-row">
                <label className="alerts-label" htmlFor="nh-url">
                  NotifyHub URL
                </label>
                <input
                  id="nh-url"
                  type="url"
                  className="alerts-input"
                  placeholder="https://notifyhub.example.com"
                  value={config.notifyhub_url}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      notifyhub_url: e.target.value,
                    }))
                  }
                  disabled={!selectedTenantId}
                />
              </div>

              <div className="alerts-form-row">
                <label className="alerts-label" htmlFor="nh-key">
                  API Key
                </label>
                <div className="alerts-password-wrap">
                  <input
                    id="nh-key"
                    type={showApiKey ? "text" : "password"}
                    className="alerts-input"
                    placeholder="Enter your NotifyHub API key"
                    value={config.notifyhub_api_key}
                    onChange={(e) =>
                      setConfig((prev) => ({
                        ...prev,
                        notifyhub_api_key: e.target.value,
                      }))
                    }
                    disabled={!selectedTenantId}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    className="alerts-password-toggle"
                    onClick={() => setShowApiKey((v) => !v)}
                    tabIndex={-1}
                    aria-label={showApiKey ? "Hide API key" : "Show API key"}
                  >
                    {showApiKey ? (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M7 3C3.5 3 1 7 1 7s2.5 4 6 4 6-4 6-4-2.5-4-6-4z"
                          stroke="currentColor"
                          strokeWidth="1.2"
                        />
                        <circle
                          cx="7"
                          cy="7"
                          r="2"
                          stroke="currentColor"
                          strokeWidth="1.2"
                        />
                        <line
                          x1="1"
                          y1="1"
                          x2="13"
                          y2="13"
                          stroke="currentColor"
                          strokeWidth="1.2"
                          strokeLinecap="round"
                        />
                      </svg>
                    ) : (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 14 14"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M7 3C3.5 3 1 7 1 7s2.5 4 6 4 6-4 6-4-2.5-4-6-4z"
                          stroke="currentColor"
                          strokeWidth="1.2"
                        />
                        <circle
                          cx="7"
                          cy="7"
                          r="2"
                          stroke="currentColor"
                          strokeWidth="1.2"
                        />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <div className="alerts-form-actions">
                <button
                  type="submit"
                  className="alerts-btn alerts-btn-primary"
                  disabled={configSaving || !selectedTenantId}
                >
                  {configSaving ? "Saving..." : "Save"}
                </button>
                {configFeedback && (
                  <span
                    className={`alerts-feedback alerts-feedback-${configFeedback.type}`}
                  >
                    {configFeedback.message}
                  </span>
                )}
              </div>
            </>
          )}
        </form>
      </section>

      {/* ────────────── ALERT RULES ─────────────────────────────── */}
      <section className="alerts-section card-surface">
        <div className="section-header">
          <div>
            <h2 className="section-title">Alert Rules</h2>
            <p className="section-subtitle">
              Define conditions that trigger notifications.
            </p>
          </div>
          {!showRuleForm && (
            <button
              className="alerts-btn alerts-btn-primary"
              onClick={openCreateForm}
              disabled={!selectedTenantId}
            >
              + Create Rule
            </button>
          )}
        </div>

        {rulesError && (
          <div className="error-banner">
            <span className="error-icon">!</span>
            <span>{rulesError}</span>
          </div>
        )}

        {!selectedTenantId && (
          <div className="alerts-empty">
            <p>Select a tenant to manage alert rules.</p>
          </div>
        )}

        {/* ─── Rule form ──────────────────────────────────────── */}
        {showRuleForm && selectedTenantId && (
          <form className="alerts-rule-form" onSubmit={handleSaveRule}>
            <div className="alerts-form-row">
              <label className="alerts-label">Rule Name</label>
              <input
                type="text"
                className="alerts-input"
                placeholder="e.g. High failure rate"
                value={ruleForm.name}
                onChange={(e) =>
                  setRuleForm((prev) => ({ ...prev, name: e.target.value }))
                }
              />
            </div>

            <div className="alerts-form-row">
              <label className="alerts-label">Metric Type</label>
              <select
                className="alerts-select"
                value={ruleForm.metric_type}
                onChange={(e) =>
                  setRuleForm((prev) => ({
                    ...prev,
                    metric_type: e.target.value,
                  }))
                }
              >
                {METRIC_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="alerts-form-inline">
              <div className="alerts-form-row">
                <label className="alerts-label">Condition</label>
                <select
                  className="alerts-select"
                  value={ruleForm.condition_type}
                  onChange={(e) =>
                    setRuleForm((prev) => ({
                      ...prev,
                      condition_type: e.target.value,
                    }))
                  }
                >
                  {CONDITION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="alerts-form-row">
                <label className="alerts-label">Threshold</label>
                <input
                  type="number"
                  className="alerts-input alerts-input-sm"
                  placeholder="0"
                  step="any"
                  value={ruleForm.threshold}
                  onChange={(e) =>
                    setRuleForm((prev) => ({
                      ...prev,
                      threshold: e.target.value,
                    }))
                  }
                />
              </div>

              <div className="alerts-form-row">
                <label className="alerts-label">Window</label>
                <select
                  className="alerts-select"
                  value={ruleForm.window}
                  onChange={(e) =>
                    setRuleForm((prev) => ({ ...prev, window: e.target.value }))
                  }
                >
                  {WINDOW_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="alerts-form-inline">
              <div className="alerts-form-row">
                <label className="alerts-label">Channel</label>
                <select
                  className="alerts-select"
                  value={ruleForm.notification_channel}
                  onChange={(e) => {
                    const ch = e.target.value;
                    setRuleForm((prev) => ({
                      ...prev,
                      notification_channel: ch,
                      notification_target: "",
                    }));
                  }}
                >
                  {CHANNEL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="alerts-form-row alerts-form-row-grow">
                <label className="alerts-label">Target</label>
                <input
                  type={
                    ruleForm.notification_channel === "email" ? "email" : "url"
                  }
                  className="alerts-input"
                  placeholder={
                    TARGET_PLACEHOLDERS[ruleForm.notification_channel]
                  }
                  value={ruleForm.notification_target}
                  onChange={(e) =>
                    setRuleForm((prev) => ({
                      ...prev,
                      notification_target: e.target.value,
                    }))
                  }
                />
              </div>
            </div>

            {ruleForm.metric_type.startsWith("ses_") && (
              <div className="alerts-form-row">
                <label className="alerts-label">SES Region</label>
                <select
                  className="alerts-select"
                  value={ruleForm.ses_region}
                  onChange={(e) =>
                    setRuleForm((prev) => ({
                      ...prev,
                      ses_region: e.target.value,
                    }))
                  }
                >
                  {SES_REGION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="alerts-form-row">
              <label className="alerts-checkbox-label">
                <input
                  type="checkbox"
                  className="alerts-checkbox"
                  checked={ruleForm.enabled}
                  onChange={(e) =>
                    setRuleForm((prev) => ({
                      ...prev,
                      enabled: e.target.checked,
                    }))
                  }
                />
                <span>Enabled</span>
              </label>
            </div>

            {ruleFeedback && (
              <div
                className={`alerts-feedback alerts-feedback-${ruleFeedback.type}`}
              >
                {ruleFeedback.message}
              </div>
            )}

            <div className="alerts-form-actions">
              <button
                type="submit"
                className="alerts-btn alerts-btn-primary"
                disabled={ruleSaving}
              >
                {ruleSaving
                  ? "Saving..."
                  : editingRuleId
                    ? "Update Rule"
                    : "Create Rule"}
              </button>
              <button
                type="button"
                className="alerts-btn alerts-btn-secondary"
                onClick={cancelForm}
                disabled={ruleSaving}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* ─── Rules list ─────────────────────────────────────── */}
        {rulesLoading && (
          <div className="alerts-loading-inline">
            <div className="spinner" />
            <span>Loading rules...</span>
          </div>
        )}

        {!rulesLoading &&
          !showRuleForm &&
          selectedTenantId &&
          rules.length === 0 && (
            <div className="alerts-empty">
              <p>No alert rules configured. Create one to get started.</p>
            </div>
          )}

        {!rulesLoading && rules.length > 0 && (
          <div className="alerts-rules-list">
            {rules.map((rule) => (
              <div key={rule.id} className="alerts-rule-card">
                <div className="alerts-rule-card-header">
                  <div className="alerts-rule-card-info">
                    <span className="alerts-rule-name">{rule.name}</span>
                    <span
                      className={`alerts-rule-status ${rule.enabled ? "enabled" : "disabled"}`}
                    >
                      {rule.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                  <div className="alerts-rule-card-actions">
                    <button
                      className="alerts-btn alerts-btn-sm"
                      onClick={() => openTestDialog(rule.id)}
                      title="Test this rule"
                    >
                      Test
                    </button>
                    <button
                      className="alerts-btn alerts-btn-sm"
                      onClick={() => openEditForm(rule)}
                      title="Edit this rule"
                    >
                      Edit
                    </button>
                    <button
                      className="alerts-btn alerts-btn-sm alerts-btn-danger"
                      onClick={() => handleDeleteRule(rule.id)}
                      title="Delete this rule"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div className="alerts-rule-card-details">
                  <div className="alerts-rule-detail">
                    <span className="alerts-detail-label">Metric</span>
                    <span className="alerts-detail-value">
                      {METRIC_OPTIONS.find((o) => o.value === rule.metric_type)
                        ?.label ?? rule.metric_type}
                    </span>
                  </div>
                  <div className="alerts-rule-detail">
                    <span className="alerts-detail-label">Condition</span>
                    <span className="alerts-detail-value">
                      {CONDITION_OPTIONS.find(
                        (o) => o.value === rule.condition_type,
                      )?.label ?? rule.condition_type}{" "}
                      {rule.threshold}
                    </span>
                  </div>
                  <div className="alerts-rule-detail">
                    <span className="alerts-detail-label">Window</span>
                    <span className="alerts-detail-value">{rule.window}</span>
                  </div>
                  <div className="alerts-rule-detail">
                    <span className="alerts-detail-label">Channel</span>
                    <span className="alerts-detail-value">
                      {CHANNEL_OPTIONS.find(
                        (o) => o.value === rule.notification_channel,
                      )?.label ?? rule.notification_channel}
                    </span>
                  </div>
                  <div className="alerts-rule-detail">
                    <span className="alerts-detail-label">Target</span>
                    <span
                      className="alerts-detail-value alerts-detail-target"
                      title={rule.notification_target}
                    >
                      {rule.notification_target}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ────────────── TEST DIALOG ──────────────────────────────── */}
      {testRuleId && (
        <div className="alerts-overlay" onClick={closeTestDialog}>
          <div className="alerts-dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="alerts-dialog-title">Test Alert Rule</h3>
            <form onSubmit={handleTestRule}>
              <div className="alerts-form-row">
                <label className="alerts-label" htmlFor="test-msg">
                  Test Message
                </label>
                <textarea
                  id="test-msg"
                  className="alerts-textarea"
                  rows={3}
                  placeholder="Enter a test message to send..."
                  value={testMessage}
                  onChange={(e) => setTestMessage(e.target.value)}
                />
              </div>

              {testFeedback && (
                <div
                  className={`alerts-feedback alerts-feedback-${testFeedback.type}`}
                >
                  {testFeedback.message}
                </div>
              )}

              <div className="alerts-form-actions">
                <button
                  type="submit"
                  className="alerts-btn alerts-btn-primary"
                  disabled={testSending}
                >
                  {testSending ? "Sending..." : "Send Test"}
                </button>
                <button
                  type="button"
                  className="alerts-btn alerts-btn-secondary"
                  onClick={closeTestDialog}
                  disabled={testSending}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default AlertsPage;
