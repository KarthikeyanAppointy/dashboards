import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../auth/AuthContext";
import "./NotificationsPage.css";

/* ─── Constants ─────────────────────────────────────────────────── */
const METRIC_OPTIONS = [
  { value: "failure_rate", label: "Failure Rate" },
  { value: "success_rate", label: "Success Rate" },
  { value: "volume", label: "Volume" },
  { value: "latency_p100", label: "P100 Latency" },
  { value: "workflow_failure", label: "Workflow Failure" },
  { value: "ses_bounce_rate", label: "SES Bounce Rate" },
  { value: "ses_complaint_rate", label: "SES Complaint Rate" },
  { value: "ses_error_rate", label: "SES Error Rate" },
  { value: "ses_send_volume", label: "SES Send Volume" },
  { value: "ses_bounce_count", label: "SES Bounce Count" },
  { value: "ses_complaint_count", label: "SES Complaint Count" },
];

const CONDITION_OPTIONS = [
  { value: "greater_than", label: "Greater Than" },
  { value: "less_than", label: "Less Than" },
];

const COOLDOWN_OPTIONS = [
  { value: "0m", label: "Off (fire once per breach)" },
  { value: "5m", label: "5 min" },
  { value: "15m", label: "15 min" },
  { value: "30m", label: "30 min" },
  { value: "1h", label: "1 hour" },
  { value: "6h", label: "6 hours" },
  { value: "24h", label: "24 hours" },
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
  { value: "webhook", label: "Webhook" },
];

const EMPTY_RULE = {
  name: "",
  metric_type: "failure_rate",
  condition_type: "greater_than",
  threshold: "",
  window: "5m",
  cooldown: "5m",
  notification_channel: "email",
  notification_target: "",
  message_template: "",
  ses_region: "",
  enabled: true,
};

const TARGET_PLACEHOLDERS = {
  email: "admin@example.com, devops@example.com",
  sms: "+1234567890",
  slack: "#alerts, #slo-monitoring",
  webhook: "https://hooks.example.com/webhook",
};

const DEFAULT_MESSAGE_TEMPLATES = {
  failure_rate:
    "Alert: {{rule_name}}\nFailure rate is {{metric_value}}% (threshold: {{condition_type}} {{threshold}}%)\nTriggered at {{timestamp}}",
  success_rate:
    "Alert: {{rule_name}}\nSuccess rate dropped to {{metric_value}}% (threshold: {{condition_type}} {{threshold}}%)\nTriggered at {{timestamp}}",
  volume:
    "Alert: {{rule_name}}\nWorkflow volume is {{metric_value}} (threshold: {{condition_type}} {{threshold}})\nTriggered at {{timestamp}}",
  latency_p100:
    "Alert: {{rule_name}}\nP100 latency is {{metric_value}}ms (threshold: {{condition_type}} {{threshold}}ms)\nTriggered at {{timestamp}}",
  workflow_failure:
    "Alert: {{rule_name}}\nWorkflow {{workflow_id}} failed\nType: {{workflow_type}} | Status: {{status}}\nTasklist: {{tasklist}} | Domain: {{domain}}\nHistory: {{workflow_history}}",
  ses_bounce_rate:
    "SES Alert: {{rule_name}}\nRegion: {{ses_region}}\nBounce rate: {{bounce_rate}} (threshold: {{condition_type}} {{threshold}}%)\nSends: {{total_sends}} | Bounces: {{bounces}} | Complaints: {{complaints}} | Rejects: {{rejects}}",
  ses_complaint_rate:
    "SES Alert: {{rule_name}}\nRegion: {{ses_region}}\nComplaint rate: {{complaint_rate}} (threshold: {{condition_type}} {{threshold}}%)\nSends: {{total_sends}} | Bounces: {{bounces}} | Complaints: {{complaints}} | Rejects: {{rejects}}",
  ses_error_rate:
    "SES Alert: {{rule_name}}\nRegion: {{ses_region}}\nError rate: {{error_rate}} (threshold: {{condition_type}} {{threshold}}%)\nSends: {{total_sends}} | Bounces: {{bounces}} | Complaints: {{complaints}} | Rejects: {{rejects}}",
  ses_send_volume:
    "SES Alert: {{rule_name}}\nRegion: {{ses_region}}\nSend volume: {{total_sends}} (threshold: {{condition_type}} {{threshold}})\nBounces: {{bounces}} | Complaints: {{complaints}} | Rejects: {{rejects}}",
  ses_bounce_count:
    "SES Alert: {{rule_name}}\nRegion: {{ses_region}}\nBounce count: {{bounces}} (threshold: {{condition_type}} {{threshold}})\nBounce rate: {{bounce_rate}} | Error rate: {{error_rate}}",
  ses_complaint_count:
    "SES Alert: {{rule_name}}\nRegion: {{ses_region}}\nComplaint count: {{complaints}} (threshold: {{condition_type}} {{threshold}})\nComplaint rate: {{complaint_rate}} | Error rate: {{error_rate}}",
};

const CHANNEL_DEFS = [
  {
    channel: "email",
    label: "Email",
    placeholder: "admin@example.com, devops@example.com",
    inputType: "text",
  },
  {
    channel: "sms",
    label: "SMS",
    placeholder: "+1234567890, +0987654321",
    inputType: "text",
  },
  {
    channel: "slack",
    label: "Slack",
    placeholder: "#alerts, #slo-monitoring",
    inputType: "text",
  },
  {
    channel: "webhook",
    label: "Webhook",
    placeholder: "https://hooks.example.com/webhook",
    inputType: "url",
  },
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

const REPORT_TYPE_OPTIONS = [
  { value: "slo_summary", label: "SLO Summary" },
  { value: "failure_report", label: "Failure Report" },
  { value: "ses_delivery_report", label: "SES Delivery Report" },
  { value: "p100_latency_report", label: "P100 Latency Report" },
];

const DEFAULT_REPORT_TEMPLATES = {
  slo_summary:
    "SLO Summary: {{report_name}}\nClient: {{client_name}} | Period: {{frequency}}\nGenerated: {{timestamp}}\n\nSuccessful (24h): {{successful_24h}}\nFailures (24h): {{failures_24h}}\nTotal Volume (24h): {{total_volume_24h}}\nP100 Latency (24h): {{p100_latency_24h}}\nSuccess Rate (24h): {{success_rate_24h}}%\nFailure Rate (24h): {{failure_rate_24h}}%\n\n{{dashboard_info}}\n\n{{ses_info}}\n\n{{p100_info}}",
  failure_report:
    "Failure Report: {{report_name}}\nPeriod: {{frequency}} | Channel: {{channel}}\nGenerated: {{timestamp}}",
  ses_delivery_report:
    "SES Delivery Report: {{report_name}}\nPeriod: {{frequency}} | Channel: {{channel}}\nGenerated: {{timestamp}}\n\n{{ses_info}}",
  p100_latency_report:
    "P100 Latency Report: {{report_name}}\nPeriod: {{frequency}}\nGenerated: {{timestamp}}\n\n{{p100_info}}",
};

const FREQUENCY_OPTIONS = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
];

const DAY_OF_WEEK_OPTIONS = [
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
  { value: 0, label: "Sunday" },
];

const TIMEZONE_OPTIONS = [
  { value: "UTC", label: "UTC (Coordinated Universal Time)" },
  { value: "America/New_York", label: "US/Eastern (EST/EDT)" },
  { value: "America/Chicago", label: "US/Central (CST/CDT)" },
  { value: "America/Denver", label: "US/Mountain (MST/MDT)" },
  { value: "America/Los_Angeles", label: "US/Pacific (PST/PDT)" },
  { value: "America/Anchorage", label: "US/Alaska (AKST/AKDT)" },
  { value: "Pacific/Honolulu", label: "US/Hawaii (HST)" },
  { value: "Europe/London", label: "UK/Ireland (GMT/BST)" },
  { value: "Europe/Paris", label: "Central Europe (CET/CEST)" },
  { value: "Europe/Berlin", label: "Germany (CET/CEST)" },
  { value: "Europe/Helsinki", label: "Eastern Europe (EET/EEST)" },
  { value: "Asia/Dubai", label: "UAE (GST)" },
  { value: "Asia/Kolkata", label: "India (IST)" },
  { value: "Asia/Bangkok", label: "Indochina (ICT)" },
  { value: "Asia/Singapore", label: "Singapore (SGT)" },
  { value: "Asia/Shanghai", label: "China (CST)" },
  { value: "Asia/Tokyo", label: "Japan (JST)" },
  { value: "Australia/Sydney", label: "Australia Eastern (AEST/AEDT)" },
  { value: "Pacific/Auckland", label: "New Zealand (NZST/NZDT)" },
];

const EMPTY_REPORT = {
  name: "",
  report_type: "slo_summary",
  frequency: "daily",
  day_of_week: 1,
  day_of_month: 1,
  send_time: "08:00",
  timezone: "UTC",
  channel: "email",
  recipients: "",
  message_template: "",
  regions: "",
  client_name: "",
  workflow_top_n: 10,
  enabled: true,
};

const CODEFAC_METRIC_OPTIONS = [
  { value: "failure_rate", label: "Failure Rate" },
  { value: "success_rate", label: "Success Rate" },
  { value: "volume", label: "Volume" },
  { value: "latency_p100", label: "P100 Latency" },
  { value: "workflow_failure", label: "Workflow Failure" },
];

const EMPTY_CODEFAC_PIPELINE = {
  name: "",
  pipeline_name: "",
  metric_type: "failure_rate",
  condition_type: "greater_than",
  threshold: "",
  cooldown: "5m",
  payload_template: JSON.stringify(
    {
      text: "⚠️ Alert: {{rule_name}}\nMetric: {{metric_type}} = {{metric_value}}\nCondition: {{condition_type}} {{threshold}}\nTenant: {{tenant_id}}",
      rule_name: "{{rule_name}}",
      metric_value: "{{metric_value}}",
      metric_type: "{{metric_type}}",
      condition_type: "{{condition_type}}",
      threshold: "{{threshold}}",
      timestamp: "{{timestamp}}",
      workflow_id: "{{workflow_id}}",
      run_id: "{{run_id}}",
      workflow_type: "{{workflow_type}}",
      "workflow-type": "{{workflow-type}}",
      domain: "{{domain}}",
      workflow_history: "{{workflow_history}}",
    },
    null,
    2,
  ),
  enabled: true,
};

/* ─── Helpers ──────────────────────────────────────────────────── */
function windowToSeconds(windowStr) {
  const match = windowStr.match(/^(\d+)([mh])$/);
  if (!match) return 300;
  const val = parseInt(match[1], 10);
  if (val === 0) return 0;
  const unit = match[2];
  if (unit === "h") return val * 3600;
  return val * 60;
}

function secondsToWindow(seconds) {
  if (!seconds) return "0m";
  const map = {
    0: "0m",
    300: "5m",
    900: "15m",
    1800: "30m",
    3600: "1h",
    21600: "6h",
    86400: "24h",
  };
  return map[seconds] || "5m";
}

/* ─── Component ─────────────────────────────────────────────────── */
function NotificationsPage({ selectedTenantId, showSnackbar }) {
  const { authFetch } = useAuth();

  /* ─── Shared: query string helper ───────────────────────────── */
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

  /* ════════════════════════════════════════════════════════════════
     SECTION 1 — NotifyHub Connection
     ════════════════════════════════════════════════════════════════ */
  const [nhConfig, setNhConfig] = useState({
    notifyhub_url: "",
    notifyhub_api_key: "",
  });
  const [nhLoading, setNhLoading] = useState(false);
  const [nhSaving, setNhSaving] = useState(false);
  const [nhFeedback, setNhFeedback] = useState(null);
  const [nhShowKey, setNhShowKey] = useState(false);
  const [nhInitialised, setNhInitialised] = useState(false);

  const fetchNhConfig = useCallback(async () => {
    if (!selectedTenantId) return;
    try {
      setNhLoading(true);
      const res = await authFetch(`/api/alerts/config${qs()}`);
      if (res.ok) {
        const json = await res.json();
        setNhConfig({
          notifyhub_url: json.notifyhub_url ?? "",
          notifyhub_api_key: json.notifyhub_api_key ?? "",
        });
      }
    } catch {
      // ignore
    } finally {
      setNhLoading(false);
      setNhInitialised(true);
    }
  }, [authFetch, qs, selectedTenantId]);

  const handleSaveNhConfig = async (e) => {
    e.preventDefault();
    if (!selectedTenantId) {
      setNhFeedback({
        type: "error",
        message: "Please select a tenant first.",
      });
      return;
    }
    try {
      setNhSaving(true);
      setNhFeedback(null);
      const res = await authFetch(`/api/alerts/config${qs()}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notifyhub_url: nhConfig.notifyhub_url.trim(),
          notifyhub_api_key: nhConfig.notifyhub_api_key.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.detail ?? `HTTP error ${res.status}`);
      }
      setNhFeedback({
        type: "success",
        message: "NotifyHub configuration saved.",
      });
    } catch (err) {
      setNhFeedback({ type: "error", message: err.message });
    } finally {
      setNhSaving(false);
    }
  };

  /* ════════════════════════════════════════════════════════════════
     SECTION 2 — Notification Channels
     ════════════════════════════════════════════════════════════════ */
  /* ─── Alert Channels state ──────────────────────────────────── */
  const [alertChannels, setAlertChannels] = useState([]);
  const [alertChannelsLoading, setAlertChannelsLoading] = useState(false);
  const [savingAlertChannels, setSavingAlertChannels] = useState({});
  const [alertChannelFeedback, setAlertChannelFeedback] = useState({});

  /* ─── Report Channels state ─────────────────────────────────── */
  const [reportChannels, setReportChannels] = useState([]);
  const [reportChannelsLoading, setReportChannelsLoading] = useState(false);
  const [savingReportChannels, setSavingReportChannels] = useState({});
  const [reportChannelFeedback, setReportChannelFeedback] = useState({});

  /* ─── Fetch alert channels ─────────────────────────────────── */
  const fetchAlertChannels = useCallback(async () => {
    if (!selectedTenantId) return;
    try {
      setAlertChannelsLoading(true);
      const res = await authFetch(
        `/api/notification-channels${qs({ scope: "alert" })}`,
      );
      if (res.ok) {
        const json = await res.json();
        setAlertChannels(Array.isArray(json) ? json : []);
      }
    } catch {
      // ignore
    } finally {
      setAlertChannelsLoading(false);
    }
  }, [authFetch, qs, selectedTenantId]);

  /* ─── Fetch report channels ────────────────────────────────── */
  const fetchReportChannels = useCallback(async () => {
    if (!selectedTenantId) return;
    try {
      setReportChannelsLoading(true);
      const res = await authFetch(
        `/api/notification-channels${qs({ scope: "report" })}`,
      );
      if (res.ok) {
        const json = await res.json();
        setReportChannels(Array.isArray(json) ? json : []);
      }
    } catch {
      // ignore
    } finally {
      setReportChannelsLoading(false);
    }
  }, [authFetch, qs, selectedTenantId]);

  /* ─── Parse comma-separated recipients string into array ──── */
  const parseRecipients = (input) =>
    input
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

  /* ─── Save alert channel ───────────────────────────────────── */
  const handleSaveAlertChannel = async (channelType) => {
    if (!selectedTenantId) {
      setAlertChannelFeedback((prev) => ({
        ...prev,
        [channelType]: {
          type: "error",
          message: "Please select a tenant first.",
        },
      }));
      return;
    }
    try {
      setSavingAlertChannels((prev) => ({ ...prev, [channelType]: true }));
      setAlertChannelFeedback((prev) => ({ ...prev, [channelType]: null }));

      const ch = alertChannels.find((c) => c.channel === channelType);
      const raw = ch?.recipientsInput ?? "";
      const recipients = parseRecipients(raw);
      const body = [{ channel: channelType, scope: "alert", recipients }];

      const res = await authFetch(`/api/notification-channels${qs()}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.detail ?? `HTTP error ${res.status}`);
      }
      setAlertChannelFeedback((prev) => ({
        ...prev,
        [channelType]: { type: "success", message: "Channel saved." },
      }));
      fetchAlertChannels();
    } catch (err) {
      setAlertChannelFeedback((prev) => ({
        ...prev,
        [channelType]: { type: "error", message: err.message },
      }));
    } finally {
      setSavingAlertChannels((prev) => ({ ...prev, [channelType]: false }));
    }
  };

  /* ─── Save report channel ──────────────────────────────────── */
  const handleSaveReportChannel = async (channelType) => {
    if (!selectedTenantId) {
      setReportChannelFeedback((prev) => ({
        ...prev,
        [channelType]: {
          type: "error",
          message: "Please select a tenant first.",
        },
      }));
      return;
    }
    try {
      setSavingReportChannels((prev) => ({ ...prev, [channelType]: true }));
      setReportChannelFeedback((prev) => ({ ...prev, [channelType]: null }));

      const ch = reportChannels.find((c) => c.channel === channelType);
      const raw =
        ch?.recipientsInput ??
        (Array.isArray(ch?.recipients) ? ch.recipients.join(", ") : "");
      const recipients = parseRecipients(raw);
      const body = [{ channel: channelType, scope: "report", recipients }];

      const res = await authFetch(`/api/notification-channels${qs()}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.detail ?? `HTTP error ${res.status}`);
      }
      setReportChannelFeedback((prev) => ({
        ...prev,
        [channelType]: { type: "success", message: "Channel saved." },
      }));
      fetchReportChannels();
    } catch (err) {
      setReportChannelFeedback((prev) => ({
        ...prev,
        [channelType]: { type: "error", message: err.message },
      }));
    } finally {
      setSavingReportChannels((prev) => ({ ...prev, [channelType]: false }));
    }
  };

  /* ─── Alert recipients change handler ──────────────────────── */
  const handleAlertRecipientsChange = (channelType, value) => {
    setAlertChannels((prev) => {
      const existing = prev.find((ch) => ch.channel === channelType);
      if (existing) {
        return prev.map((ch) =>
          ch.channel === channelType ? { ...ch, recipientsInput: value } : ch,
        );
      }
      return [
        ...prev,
        { channel: channelType, recipients: [], recipientsInput: value },
      ];
    });
  };

  /* ─── Report recipients change handler ─────────────────────── */
  const handleReportRecipientsChange = (channelType, value) => {
    setReportChannels((prev) => {
      const existing = prev.find((ch) => ch.channel === channelType);
      if (existing) {
        return prev.map((ch) =>
          ch.channel === channelType ? { ...ch, recipientsInput: value } : ch,
        );
      }
      return [
        ...prev,
        { channel: channelType, recipients: [], recipientsInput: value },
      ];
    });
  };

  /* ─── Get alert recipients input ───────────────────────────── */
  const getAlertRecipientsInput = (channelType) => {
    const ch = alertChannels.find((c) => c.channel === channelType);
    if (ch && ch.recipientsInput !== undefined) return ch.recipientsInput;
    if (ch && Array.isArray(ch.recipients)) return ch.recipients.join(", ");
    return "";
  };

  /* ─── Get report recipients input ──────────────────────────── */
  const getReportRecipientsInput = (channelType) => {
    const ch = reportChannels.find((c) => c.channel === channelType);
    if (ch && ch.recipientsInput !== undefined) return ch.recipientsInput;
    if (ch && Array.isArray(ch.recipients)) return ch.recipients.join(", ");
    return "";
  };

  /* ════════════════════════════════════════════════════════════════
     SECTION 3 — Alert Rules
     ════════════════════════════════════════════════════════════════ */
  const [rules, setRules] = useState([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [rulesError, setRulesError] = useState(null);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [ruleForm, setRuleForm] = useState({ ...EMPTY_RULE });
  const [ruleSaving, setRuleSaving] = useState(false);
  const [ruleFeedback, setRuleFeedback] = useState(null);

  const fetchRules = useCallback(async () => {
    if (!selectedTenantId) {
      setRules([]);
      return;
    }
    try {
      setRulesLoading(true);
      setRulesError(null);
      const res = await authFetch(`/api/alerts/rules${qs()}`);
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const json = await res.json();
      setRules(Array.isArray(json) ? json : (json.rules ?? []));
    } catch (err) {
      setRulesError(err.message);
    } finally {
      setRulesLoading(false);
    }
  }, [authFetch, qs, selectedTenantId]);

  const openCreateForm = () => {
    setEditingRuleId(null);
    setRuleForm({
      ...EMPTY_RULE,
      message_template: DEFAULT_MESSAGE_TEMPLATES[EMPTY_RULE.metric_type] || "",
    });
    setRuleFeedback(null);
    setShowRuleForm(true);
  };

  const openEditForm = (rule) => {
    setEditingRuleId(rule.id);
    setRuleForm({
      name: rule.name ?? "",
      metric_type: rule.metric_type ?? "failure_rate",
      condition_type: rule.condition_type ?? "greater_than",
      threshold: rule.threshold ?? "",
      window: secondsToWindow(rule.window_seconds) || "5m",
      cooldown: secondsToWindow(rule.cooldown_seconds) || "5m",
      notification_channel: rule.notification_channel ?? "email",
      notification_target: rule.notification_target ?? "",
      message_template: rule.message_template ?? "",
      ses_region: rule.ses_region ?? "",
      enabled: rule.enabled ?? true,
    });
    setRuleFeedback(null);
    setShowRuleForm(true);
  };

  const cancelForm = () => {
    setShowRuleForm(false);
    setEditingRuleId(null);
    setRuleForm({ ...EMPTY_RULE });
    setRuleFeedback(null);
  };

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
    const isWorkflowFailure =
      ruleForm.metric_type === "workflow_failure" ||
      ruleForm.metric_type === "forward_workflow";
    if (
      !isWorkflowFailure &&
      (!ruleForm.threshold || isNaN(Number(ruleForm.threshold)))
    ) {
      setRuleFeedback({
        type: "error",
        message: "A valid numeric threshold is required.",
      });
      return;
    }
    try {
      setRuleSaving(true);
      setRuleFeedback(null);

      // Auto-populate notification_target from the alert channels config
      const ch = alertChannels.find(
        (c) => c.channel === ruleForm.notification_channel,
      );
      const raw =
        ch?.recipientsInput ??
        (Array.isArray(ch?.recipients) ? ch.recipients.join(", ") : "");
      const targets = raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const body = {
        name: ruleForm.name.trim(),
        metric_type: ruleForm.metric_type,
        alert_type: isWorkflowFailure ? "forward" : "threshold",
        notification_channel: ruleForm.notification_channel,
        notification_target: targets.join(", "),
        message_template: ruleForm.message_template,
        ses_region: ruleForm.ses_region || "",
        cooldown_seconds: windowToSeconds(ruleForm.cooldown),
        enabled: ruleForm.enabled,
      };
      if (!isWorkflowFailure) {
        body.condition_type = ruleForm.condition_type;
        body.threshold = Number(ruleForm.threshold);
        body.window_seconds = windowToSeconds(ruleForm.window);
      }
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
      showSnackbar(
        editingRuleId
          ? "Alert rule saved successfully"
          : "Alert rule created successfully",
        "success",
      );
      cancelForm();
      fetchRules();
    } catch (err) {
      setRuleFeedback({ type: "error", message: err.message });
    } finally {
      setRuleSaving(false);
    }
  };

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

  // Direct trigger with actual dashboard data (no dialog)
  const handleTriggerRule = async (ruleId) => {
    if (!selectedTenantId) {
      showSnackbar("Please select a tenant first.", "error");
      return;
    }
    try {
      setRuleSaving(true);
      const res = await authFetch(`/api/alerts/rules/test${qs()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rule_id: ruleId, message: "" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.detail ?? `HTTP error ${res.status}`);
      }
      showSnackbar("Alert rule triggered with current data", "success");
    } catch (err) {
      showSnackbar(err.message, "error");
    } finally {
      setRuleSaving(false);
    }
  };

  /* ════════════════════════════════════════════════════════════════
     SECTION 4 — Scheduled Reports
     ════════════════════════════════════════════════════════════════ */
  const [reports, setReports] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState(null);
  const [showReportForm, setShowReportForm] = useState(false);
  const [editingReportId, setEditingReportId] = useState(null);
  const [reportForm, setReportForm] = useState({ ...EMPTY_REPORT });
  const [reportSaving, setReportSaving] = useState(false);
  const [reportFeedback, setReportFeedback] = useState(null);
  const [sesRegions, setSesRegions] = useState([]);

  const fetchReports = useCallback(async () => {
    if (!selectedTenantId) {
      setReports([]);
      return;
    }
    try {
      setReportsLoading(true);
      setReportsError(null);
      const res = await authFetch(`/api/reports${qs()}`);
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const json = await res.json();
      setReports(Array.isArray(json) ? json : (json.reports ?? []));
    } catch (err) {
      setReportsError(err.message);
    } finally {
      setReportsLoading(false);
    }
  }, [authFetch, qs, selectedTenantId]);

  const fetchSesRegions = useCallback(async () => {
    try {
      const res = await authFetch("/api/ses-regions");
      if (res.ok) {
        const json = await res.json();
        if (json.regions && json.regions.length > 0) {
          setSesRegions(json.regions);
        }
      }
    } catch {
      // ignore
    }
  }, [authFetch]);

  const openCreateReportForm = () => {
    setEditingReportId(null);
    setReportForm({
      ...EMPTY_REPORT,
      message_template:
        DEFAULT_REPORT_TEMPLATES[EMPTY_REPORT.report_type] || "",
    });
    setReportFeedback(null);
    setShowReportForm(true);
  };

  const openEditReportForm = (report) => {
    setEditingReportId(report.id);
    setReportForm({
      name: report.name ?? "",
      report_type: report.report_type ?? "slo_summary",
      frequency: report.frequency ?? "daily",
      day_of_week: report.day_of_week ?? 1,
      day_of_month: report.day_of_month ?? 1,
      send_time: report.send_time ?? "08:00",
      timezone: report.timezone ?? "UTC",
      channel: report.channel ?? "email",
      recipients: report.recipients ?? "",
      message_template: report.message_template ?? "",
      regions: Array.isArray(report.regions)
        ? report.regions.join(", ")
        : (report.regions ?? ""),
      client_name: report.client_name ?? "",
      workflow_top_n: report.workflow_top_n ?? 10,
      enabled: report.enabled ?? true,
    });
    setReportFeedback(null);
    setShowReportForm(true);
  };

  const cancelReportForm = () => {
    setShowReportForm(false);
    setEditingReportId(null);
    setReportForm({ ...EMPTY_REPORT });
    setReportFeedback(null);
  };

  const handleSaveReport = async (e) => {
    e.preventDefault();
    if (!selectedTenantId) {
      setReportFeedback({
        type: "error",
        message: "Please select a tenant first.",
      });
      return;
    }
    if (!reportForm.name.trim()) {
      setReportFeedback({ type: "error", message: "Report name is required." });
      return;
    }
    try {
      setReportSaving(true);
      setReportFeedback(null);

      // Auto-populate recipients from report channels config
      const ch = reportChannels.find((c) => c.channel === reportForm.channel);
      const raw =
        ch?.recipientsInput ??
        (Array.isArray(ch?.recipients) ? ch.recipients.join(", ") : "");
      const recipientsArr = raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      const body = {
        name: reportForm.name.trim(),
        report_type: reportForm.report_type,
        frequency: reportForm.frequency,
        send_time: reportForm.send_time,
        timezone: reportForm.timezone,
        channel: reportForm.channel,
        recipients: recipientsArr,
        message_template: reportForm.message_template,
        regions: reportForm.regions
          ? reportForm.regions
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
        client_name: reportForm.client_name || "",
        workflow_top_n: Number(reportForm.workflow_top_n) || 10,
        enabled: reportForm.enabled,
      };
      if (reportForm.frequency === "weekly") {
        body.day_of_week = reportForm.day_of_week;
      }
      if (reportForm.frequency === "monthly") {
        body.day_of_month = Number(reportForm.day_of_month);
      }
      let url;
      let method;
      if (editingReportId) {
        url = `/api/reports${qs({ id: editingReportId })}`;
        method = "PUT";
      } else {
        url = `/api/reports${qs()}`;
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
      showSnackbar(
        editingReportId
          ? "Report saved successfully"
          : "Report created successfully",
        "success",
      );
      cancelReportForm();
      fetchReports();
    } catch (err) {
      setReportFeedback({ type: "error", message: err.message });
    } finally {
      setReportSaving(false);
    }
  };

  const handleTriggerReport = async (report) => {
    if (!selectedTenantId) return;
    try {
      const res = await authFetch(
        `/api/reports/trigger${qs({ id: report.id })}`,
        {
          method: "POST",
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.detail ?? `HTTP error ${res.status}`);
      }
      fetchReports();
    } catch (err) {
      setReportsError(err.message);
    }
  };

  const handleDeleteReport = async (reportId) => {
    if (!selectedTenantId) return;
    if (
      !window.confirm("Are you sure you want to delete this scheduled report?")
    )
      return;
    try {
      const res = await authFetch(`/api/reports${qs({ id: reportId })}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.detail ?? `HTTP error ${res.status}`);
      }
      fetchReports();
    } catch (err) {
      setReportsError(err.message);
    }
  };

  /* ════════════════════════════════════════════════════════════════
     SECTION 4b — Codefac Pipelines
     ════════════════════════════════════════════════════════════════ */
  const [codefacPipelines, setCodefacPipelines] = useState([]);
  const [codefacPipelinesLoading, setCodefacPipelinesLoading] = useState(false);
  const [codefacPipelinesError, setCodefacPipelinesError] = useState(null);
  const [showCodefacForm, setShowCodefacForm] = useState(false);
  const [editingCodefacId, setEditingCodefacId] = useState(null);
  const [codefacForm, setCodefacForm] = useState({ ...EMPTY_CODEFAC_PIPELINE });
  const [codefacSaving, setCodefacSaving] = useState(false);
  const [codefacFeedback, setCodefacFeedback] = useState(null);

  const fetchCodefacPipelines = useCallback(async () => {
    if (!selectedTenantId) {
      setCodefacPipelines([]);
      return;
    }
    try {
      setCodefacPipelinesLoading(true);
      setCodefacPipelinesError(null);
      const res = await authFetch(`/api/codefac-pipelines${qs()}`);
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const json = await res.json();
      setCodefacPipelines(Array.isArray(json) ? json : []);
    } catch (err) {
      setCodefacPipelinesError(err.message);
    } finally {
      setCodefacPipelinesLoading(false);
    }
  }, [authFetch, qs, selectedTenantId]);

  const openCreateCodefacForm = () => {
    setEditingCodefacId(null);
    setCodefacForm({ ...EMPTY_CODEFAC_PIPELINE });
    setCodefacFeedback(null);
    setShowCodefacForm(true);
  };

  const openEditCodefacForm = (pipeline) => {
    setEditingCodefacId(pipeline.id);
    setCodefacForm({
      name: pipeline.name ?? "",
      pipeline_name: pipeline.pipeline_name ?? "",
      metric_type: pipeline.metric_type ?? "failure_rate",
      condition_type: pipeline.condition_type ?? "greater_than",
      threshold: pipeline.threshold ?? "",
      cooldown: secondsToWindow(pipeline.cooldown_seconds) || "5m",
      payload_template:
        pipeline.payload_template ?? EMPTY_CODEFAC_PIPELINE.payload_template,
      enabled: pipeline.enabled ?? true,
    });
    setCodefacFeedback(null);
    setShowCodefacForm(true);
  };

  const cancelCodefacForm = () => {
    setShowCodefacForm(false);
    setEditingCodefacId(null);
    setCodefacForm({ ...EMPTY_CODEFAC_PIPELINE });
    setCodefacFeedback(null);
  };

  const handleSaveCodefac = async (e) => {
    e.preventDefault();
    if (!selectedTenantId) {
      setCodefacFeedback({
        type: "error",
        message: "Please select a tenant first.",
      });
      return;
    }
    if (!codefacForm.name.trim()) {
      setCodefacFeedback({
        type: "error",
        message: "Pipeline name is required.",
      });
      return;
    }
    if (!codefacForm.pipeline_name.trim()) {
      setCodefacFeedback({
        type: "error",
        message: "Codefac pipeline name is required.",
      });
      return;
    }
    if (codefacForm.metric_type !== "workflow_failure") {
      if (!codefacForm.threshold || isNaN(Number(codefacForm.threshold))) {
        setCodefacFeedback({
          type: "error",
          message: "A valid numeric threshold is required.",
        });
        return;
      }
    }
    try {
      setCodefacSaving(true);
      setCodefacFeedback(null);

      // Validate JSON for payload_template
      try {
        JSON.parse(codefacForm.payload_template);
      } catch {
        setCodefacFeedback({
          type: "error",
          message: "Payload template must be valid JSON.",
        });
        setCodefacSaving(false);
        return;
      }

      const body = {
        name: codefacForm.name.trim(),
        pipeline_name: codefacForm.pipeline_name.trim(),
        metric_type: codefacForm.metric_type,
        condition_type: codefacForm.condition_type,
        payload_template: codefacForm.payload_template,
        cooldown_seconds: windowToSeconds(codefacForm.cooldown),
        enabled: codefacForm.enabled,
      };
      if (codefacForm.metric_type !== "workflow_failure") {
        body.threshold = Number(codefacForm.threshold);
      } else {
        body.threshold = 0;
      }
      let url;
      let method;
      if (editingCodefacId) {
        url = `/api/codefac-pipelines${qs({ id: editingCodefacId })}`;
        method = "PUT";
      } else {
        url = `/api/codefac-pipelines${qs()}`;
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
      setCodefacFeedback({
        type: "success",
        message: editingCodefacId
          ? "Pipeline updated successfully."
          : "Pipeline created successfully.",
      });
      cancelCodefacForm();
      fetchCodefacPipelines();
    } catch (err) {
      setCodefacFeedback({ type: "error", message: err.message });
    } finally {
      setCodefacSaving(false);
    }
  };

  const handleDeleteCodefac = async (pipelineId) => {
    if (!selectedTenantId) return;
    if (
      !window.confirm("Are you sure you want to delete this Codefac pipeline?")
    )
      return;
    try {
      const res = await authFetch(
        `/api/codefac-pipelines${qs({ id: pipelineId })}`,
        {
          method: "DELETE",
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.detail ?? `HTTP error ${res.status}`);
      }
      fetchCodefacPipelines();
    } catch (err) {
      setCodefacPipelinesError(err.message);
    }
  };

  const handleToggleCodefacPause = async (pipeline) => {
    if (!selectedTenantId) return;
    try {
      const res = await authFetch(
        `/api/codefac-pipelines${qs({ id: pipeline.id })}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: pipeline.name,
            pipeline_name: pipeline.pipeline_name,
            metric_type: pipeline.metric_type,
            condition_type: pipeline.condition_type,
            threshold: pipeline.threshold,
            payload_template: pipeline.payload_template,
            enabled: !pipeline.enabled,
          }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.detail ?? `HTTP error ${res.status}`);
      }
      fetchCodefacPipelines();
    } catch (err) {
      setCodefacPipelinesError(err.message);
    }
  };

  /* ─── Load data on tenant change ────────────────────────────── */
  useEffect(() => {
    fetchNhConfig();
    fetchAlertChannels();
    fetchReportChannels();
    fetchRules();
    fetchReports();
    fetchSesRegions();
    fetchCodefacPipelines();
  }, [
    fetchNhConfig,
    fetchAlertChannels,
    fetchReportChannels,
    fetchRules,
    fetchReports,
    fetchSesRegions,
    fetchCodefacPipelines,
  ]);

  /* ─── Helpers ───────────────────────────────────────────────── */
  const formatTimestamp = (ts) => {
    if (!ts) return "";
    try {
      const d = new Date(ts);
      if (isNaN(d.getTime())) return ts;
      return d.toLocaleString();
    } catch {
      return ts;
    }
  };

  /* ════════════════════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════════════════════ */
  return (
    <div className="alerts-page">
      {/* ──── SECTION 1: NotifyHub Connection ─────────────────────── */}
      <section className="alerts-section card-surface">
        <div className="section-header">
          <div>
            <h2 className="section-title">NotifyHub Connection</h2>
            <p className="section-subtitle">
              Configure the NotifyHub service for alert delivery.
            </p>
          </div>
        </div>

        {!selectedTenantId && (
          <div className="alerts-empty">
            <p>Select a tenant to configure the NotifyHub connection.</p>
          </div>
        )}

        {nhLoading && (
          <div className="alerts-loading-inline">
            <div className="spinner" />
            <span>Loading configuration...</span>
          </div>
        )}

        {selectedTenantId && !nhLoading && (
          <form className="alerts-config-form" onSubmit={handleSaveNhConfig}>
            <div className="alerts-form-row">
              <label className="alerts-label">NotifyHub URL</label>
              <input
                type="url"
                className="alerts-input"
                placeholder="https://notifyhub.example.com"
                value={nhConfig.notifyhub_url}
                onChange={(e) =>
                  setNhConfig((prev) => ({
                    ...prev,
                    notifyhub_url: e.target.value,
                  }))
                }
                disabled={!selectedTenantId}
              />
            </div>

            <div className="alerts-form-row">
              <label className="alerts-label">NotifyHub API Key</label>
              <div className="alerts-password-wrap">
                <input
                  type={nhShowKey ? "text" : "password"}
                  className="alerts-input"
                  placeholder="Enter your API key"
                  value={nhConfig.notifyhub_api_key}
                  onChange={(e) =>
                    setNhConfig((prev) => ({
                      ...prev,
                      notifyhub_api_key: e.target.value,
                    }))
                  }
                  disabled={!selectedTenantId}
                />
                <button
                  type="button"
                  className="alerts-password-toggle"
                  onClick={() => setNhShowKey((prev) => !prev)}
                  title={nhShowKey ? "Hide API key" : "Show API key"}
                >
                  {nhShowKey ? "🙈" : "👁"}
                </button>
              </div>
            </div>

            {nhFeedback && (
              <div
                className={`alerts-feedback alerts-feedback-${nhFeedback.type}`}
              >
                {nhFeedback.message}
              </div>
            )}

            <div className="alerts-form-actions">
              <button
                type="submit"
                className="alerts-btn alerts-btn-primary"
                disabled={nhSaving || !selectedTenantId}
              >
                {nhSaving ? "Saving..." : "Save Configuration"}
              </button>
            </div>
          </form>
        )}
      </section>

      {/* ──── SECTION 2: Notification Channels ───────────────────── */}
      <section data-section="channels" className="alerts-section card-surface">
        <div className="section-header">
          <div>
            <h2 className="section-title">Notification Channels</h2>
            <p className="section-subtitle">
              Configure recipients for alerts and scheduled reports.
            </p>
          </div>
        </div>

        {!selectedTenantId && (
          <div className="alerts-empty">
            <p>Select a tenant to configure notification channels.</p>
          </div>
        )}

        {selectedTenantId && (
          <div className="channels-table-wrap">
            <table className="channels-table">
              <thead>
                <tr>
                  <th className="channels-col-channel">Channel</th>
                  <th className="channels-col-recipients">Alert Recipients</th>
                  <th className="channels-col-recipients">Report Recipients</th>
                  <th className="channels-col-actions"></th>
                </tr>
              </thead>
              <tbody>
                {CHANNEL_DEFS.map((chDef) => (
                  <tr key={chDef.channel}>
                    <td>
                      <span className="channels-channel-name">
                        {chDef.label}
                      </span>
                    </td>
                    <td>
                      <div className="channels-input-row">
                        <input
                          type={chDef.inputType}
                          className="alerts-input"
                          placeholder={chDef.placeholder}
                          value={getAlertRecipientsInput(chDef.channel)}
                          onChange={(e) =>
                            handleAlertRecipientsChange(
                              chDef.channel,
                              e.target.value,
                            )
                          }
                        />
                        <button
                          className="channels-save-btn"
                          onClick={() => handleSaveAlertChannel(chDef.channel)}
                          disabled={savingAlertChannels[chDef.channel]}
                          title="Save alert recipients"
                        >
                          {savingAlertChannels[chDef.channel] ? (
                            <span className="spinner-tiny" />
                          ) : (
                            <svg
                              width="13"
                              height="13"
                              viewBox="0 0 15 15"
                              fill="none"
                              aria-hidden="true"
                            >
                              <path
                                d="M3 8L6 11L12 4"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </button>
                        {alertChannelFeedback[chDef.channel] && (
                          <span
                            className={`channels-feedback channels-feedback-${alertChannelFeedback[chDef.channel].type}`}
                            title={alertChannelFeedback[chDef.channel].message}
                          >
                            {alertChannelFeedback[chDef.channel].type ===
                            "success"
                              ? "✓"
                              : "✗"}
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="channels-input-row">
                        <input
                          type={chDef.inputType}
                          className="alerts-input"
                          placeholder={chDef.placeholder}
                          value={getReportRecipientsInput(chDef.channel)}
                          onChange={(e) =>
                            handleReportRecipientsChange(
                              chDef.channel,
                              e.target.value,
                            )
                          }
                        />
                        <button
                          className="channels-save-btn"
                          onClick={() => handleSaveReportChannel(chDef.channel)}
                          disabled={savingReportChannels[chDef.channel]}
                          title="Save report recipients"
                        >
                          {savingReportChannels[chDef.channel] ? (
                            <span className="spinner-tiny" />
                          ) : (
                            <svg
                              width="13"
                              height="13"
                              viewBox="0 0 15 15"
                              fill="none"
                              aria-hidden="true"
                            >
                              <path
                                d="M3 8L6 11L12 4"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </button>
                        {reportChannelFeedback[chDef.channel] && (
                          <span
                            className={`channels-feedback channels-feedback-${reportChannelFeedback[chDef.channel].type}`}
                            title={reportChannelFeedback[chDef.channel].message}
                          >
                            {reportChannelFeedback[chDef.channel].type ===
                            "success"
                              ? "✓"
                              : "✗"}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="channels-col-actions">
                      {/* feedback tooltip */}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ──── SECTION 3: Alert Rules ─────────────────────────────── */}
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
                    message_template:
                      prev.message_template ||
                      DEFAULT_MESSAGE_TEMPLATES[e.target.value] ||
                      "",
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

            {ruleForm.metric_type !== "workflow_failure" &&
              ruleForm.metric_type !== "forward_workflow" && (
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
                        setRuleForm((prev) => ({
                          ...prev,
                          window: e.target.value,
                        }))
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
              )}

            <div className="alerts-form-row">
              <label className="alerts-label">
                Cooldown
                <span className="alerts-label-hint">
                  {" "}
                  — Minimum time before this rule can fire again
                </span>
              </label>
              <select
                className="alerts-select"
                value={ruleForm.cooldown}
                onChange={(e) =>
                  setRuleForm((prev) => ({
                    ...prev,
                    cooldown: e.target.value,
                  }))
                }
              >
                {COOLDOWN_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
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
                <label className="alerts-label">
                  Recipients (from Alert Channels)
                </label>
                <div className="channels-recipients-preview">
                  {(() => {
                    const ch = alertChannels.find(
                      (c) => c.channel === ruleForm.notification_channel,
                    );
                    const raw =
                      ch?.recipientsInput ??
                      (Array.isArray(ch?.recipients)
                        ? ch.recipients.join(", ")
                        : "");
                    const list = raw
                      .split(",")
                      .map((s) => s.trim())
                      .filter((s) => s.length > 0);
                    return list.length > 0
                      ? list.map((r, i) => (
                          <span key={i} className="channels-recipient-tag">
                            {r}
                          </span>
                        ))
                      : [
                          <span
                            key="empty"
                            className="channels-recipients-empty"
                          >
                            No recipients configured for{" "}
                            {ruleForm.notification_channel}.{" "}
                            <a
                              href="/notifications"
                              onClick={(e) => {
                                e.preventDefault();
                                document
                                  .querySelector('[data-section="channels"]')
                                  ?.scrollIntoView({ behavior: "smooth" });
                              }}
                            >
                              Configure in Alert Channels
                            </a>
                          </span>,
                        ];
                  })()}
                </div>
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
              <label className="alerts-label">
                Message Template
                <span className="alerts-label-hint">
                  {" "}
                  — Custom notification body.{" "}
                  {ruleForm.metric_type === "workflow_failure" ||
                  ruleForm.metric_type === "forward_workflow"
                    ? "Variables: " +
                      "{{rule_name}}, {{alert_name}}, {{workflow_id}}, {{run_id}}, " +
                      "{{workflow_type}}, {{workflow-type}}, {{tasklist}}, {{status}}, {{close_time}}, " +
                      "{{domain}}, {{workflow_history}} (GCS URL when GCS_HISTORY_BUCKET set; else inline JSON; also {{history}})"
                    : ruleForm.metric_type.startsWith("ses_")
                      ? "Variables: {{rule_name}}, {{metric_type}}, {{metric_value}}, {{condition_type}}, {{threshold}}, {{ses_region}}, {{total_sends}}, {{bounces}}, {{complaints}}, {{rejects}}, {{bounce_rate}}, {{complaint_rate}}, {{error_rate}}"
                      : "Variables: " +
                        "{{rule_name}}, {{metric_type}}, {{metric_value}}, " +
                        "{{condition_type}}, {{threshold}}, {{alert_name}}"}
                </span>
              </label>
              <textarea
                className="alerts-textarea alerts-textarea-code"
                rows={3}
                placeholder={
                  "Alert {{rule_name}} triggered: {{metric_type}} = {{metric_value}} (threshold: {{condition_type}} {{threshold}})"
                }
                value={ruleForm.message_template}
                onChange={(e) =>
                  setRuleForm((prev) => ({
                    ...prev,
                    message_template: e.target.value,
                  }))
                }
                spellCheck={false}
              />
            </div>

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
                      onClick={() => handleTriggerRule(rule.id)}
                      title="Trigger this rule with current data"
                    >
                      Trigger
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
                    <span className="alerts-detail-value">
                      {secondsToWindow(rule.window_seconds) || "—"}
                    </span>
                  </div>
                  <div className="alerts-rule-detail">
                    <span className="alerts-detail-label">Cooldown</span>
                    <span className="alerts-detail-value">
                      {secondsToWindow(rule.cooldown_seconds) || "5m"}
                    </span>
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

      {/* ──── SECTION 4: Scheduled Reports ───────────────────────── */}
      <section className="alerts-section card-surface">
        <div className="section-header">
          <div>
            <h2 className="section-title">Scheduled Reports</h2>
            <p className="section-subtitle">
              Configure automated report delivery on a schedule.
            </p>
          </div>
          {!showReportForm && (
            <button
              className="alerts-btn alerts-btn-primary"
              onClick={openCreateReportForm}
              disabled={!selectedTenantId}
            >
              + Create Report
            </button>
          )}
        </div>

        {reportsError && (
          <div className="error-banner">
            <span className="error-icon">!</span>
            <span>{reportsError}</span>
          </div>
        )}

        {!selectedTenantId && (
          <div className="alerts-empty">
            <p>Select a tenant to manage scheduled reports.</p>
          </div>
        )}

        {/* ─── Report form ────────────────────────────────────── */}
        {showReportForm && selectedTenantId && (
          <form className="alerts-rule-form" onSubmit={handleSaveReport}>
            <div className="alerts-form-row">
              <label className="alerts-label">Report Name</label>
              <input
                type="text"
                className="alerts-input"
                placeholder="e.g. Daily SLO Summary"
                value={reportForm.name}
                onChange={(e) =>
                  setReportForm((prev) => ({ ...prev, name: e.target.value }))
                }
              />
            </div>

            <div className="alerts-form-inline">
              <div className="alerts-form-row">
                <label className="alerts-label">Report Type</label>
                <select
                  className="alerts-select"
                  value={reportForm.report_type}
                  onChange={(e) =>
                    setReportForm((prev) => ({
                      ...prev,
                      report_type: e.target.value,
                      message_template:
                        prev.message_template ||
                        DEFAULT_REPORT_TEMPLATES[e.target.value] ||
                        "",
                    }))
                  }
                >
                  {REPORT_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {reportForm.report_type === "slo_summary" && (
                <div className="alerts-form-row">
                  <label className="alerts-label">Client</label>
                  <input
                    type="text"
                    className="alerts-input"
                    placeholder="e.g. qa-mathnasium"
                    value={reportForm.client_name || ""}
                    onChange={(e) =>
                      setReportForm((prev) => ({
                        ...prev,
                        client_name: e.target.value,
                      }))
                    }
                  />
                </div>
              )}
              {reportForm.report_type === "p100_latency_report" && (
                <div className="alerts-form-row">
                  <label className="alerts-label">
                    Top N Workflows
                    <span className="alerts-label-hint">
                      {" "}
                      — Number of top workflows by P100 latency to include in
                      the report
                    </span>
                  </label>
                  <input
                    type="number"
                    className="alerts-input alerts-input-sm"
                    min={1}
                    max={100}
                    value={reportForm.workflow_top_n}
                    onChange={(e) =>
                      setReportForm((prev) => ({
                        ...prev,
                        workflow_top_n: Math.min(
                          100,
                          Math.max(1, Number(e.target.value) || 10),
                        ),
                      }))
                    }
                  />
                </div>
              )}
            </div>

            <div className="alerts-form-inline">
              <div className="alerts-form-row">
                <label className="alerts-label">Frequency</label>
                <select
                  className="alerts-select"
                  value={reportForm.frequency}
                  onChange={(e) =>
                    setReportForm((prev) => ({
                      ...prev,
                      frequency: e.target.value,
                    }))
                  }
                >
                  {FREQUENCY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="alerts-form-row">
                <label className="alerts-label">Send Time</label>
                <input
                  type="time"
                  className="alerts-input alerts-input-sm"
                  value={reportForm.send_time}
                  onChange={(e) =>
                    setReportForm((prev) => ({
                      ...prev,
                      send_time: e.target.value,
                    }))
                  }
                />
              </div>

              {reportForm.frequency === "weekly" && (
                <div className="alerts-form-row">
                  <label className="alerts-label">Day of Week</label>
                  <select
                    className="alerts-select"
                    value={reportForm.day_of_week}
                    onChange={(e) =>
                      setReportForm((prev) => ({
                        ...prev,
                        day_of_week: e.target.value,
                      }))
                    }
                  >
                    {DAY_OF_WEEK_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {reportForm.frequency === "monthly" && (
                <div className="alerts-form-row">
                  <label className="alerts-label">Day of Month</label>
                  <input
                    type="number"
                    className="alerts-input alerts-input-sm"
                    min={1}
                    max={28}
                    value={reportForm.day_of_month}
                    onChange={(e) =>
                      setReportForm((prev) => ({
                        ...prev,
                        day_of_month: Math.min(
                          28,
                          Math.max(1, Number(e.target.value) || 1),
                        ),
                      }))
                    }
                  />
                </div>
              )}
            </div>

            <div className="alerts-form-row">
              <label className="alerts-label">Timezone</label>
              <select
                className="alerts-select"
                value={reportForm.timezone}
                onChange={(e) =>
                  setReportForm((prev) => ({
                    ...prev,
                    timezone: e.target.value,
                  }))
                }
              >
                {TIMEZONE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {reportForm.report_type === "ses_delivery_report" && (
              <div className="alerts-form-row">
                <label className="alerts-label">
                  SES Regions
                  <span className="alerts-label-hint">
                    {" "}
                    — Comma-separated list of SES regions to include
                  </span>
                </label>
                <input
                  type="text"
                  className="alerts-input"
                  placeholder={
                    sesRegions.length > 0
                      ? sesRegions.join(", ")
                      : "us-east-1, ap-southeast-2"
                  }
                  value={reportForm.regions}
                  onChange={(e) =>
                    setReportForm((prev) => ({
                      ...prev,
                      regions: e.target.value,
                    }))
                  }
                />
              </div>
            )}

            <div className="alerts-form-inline">
              <div className="alerts-form-row">
                <label className="alerts-label">Channel</label>
                <select
                  className="alerts-select"
                  value={reportForm.channel}
                  onChange={(e) =>
                    setReportForm((prev) => ({
                      ...prev,
                      channel: e.target.value,
                    }))
                  }
                >
                  {CHANNEL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="alerts-form-row alerts-form-row-grow">
                <label className="alerts-label">
                  Recipients (from Report Channels)
                </label>
                <div className="channels-recipients-preview">
                  {(() => {
                    const ch = reportChannels.find(
                      (c) => c.channel === reportForm.channel,
                    );
                    const raw =
                      ch?.recipientsInput ??
                      (Array.isArray(ch?.recipients)
                        ? ch.recipients.join(", ")
                        : "");
                    const list = raw
                      .split(",")
                      .map((s) => s.trim())
                      .filter((s) => s.length > 0);
                    return list.length > 0
                      ? list.map((r, i) => (
                          <span key={i} className="channels-recipient-tag">
                            {r}
                          </span>
                        ))
                      : [
                          <span
                            key="empty"
                            className="channels-recipients-empty"
                          >
                            No recipients configured for {reportForm.channel}.{" "}
                            <a
                              href="/notifications"
                              onClick={(e) => {
                                e.preventDefault();
                                document
                                  .querySelector('[data-section="channels"]')
                                  ?.scrollIntoView({ behavior: "smooth" });
                              }}
                            >
                              Configure in Report Channels
                            </a>
                          </span>,
                        ];
                  })()}
                </div>
              </div>
            </div>

            <div className="alerts-form-row">
              <label className="alerts-label">
                Message Template
                <span className="alerts-label-hint">
                  {" "}
                  — Custom report body. Variables:{" "}
                  <code>{"{{report_name}}"}</code>,{" "}
                  <code>{"{{report_type}}"}</code>,{" "}
                  <code>{"{{frequency}}"}</code>, <code>{"{{channel}}"}</code>,{" "}
                  <code>{"{{timestamp}}"}</code>,{" "}
                  <code>{"{{client_name}}"}</code>,{" "}
                  <code>{"{{ses_info}}"}</code>,{" "}
                  <code>{"{{dashboard_info}}"}</code>,{" "}
                  <code>{"{{p100_info}}"}</code>,{" "}
                  <code>{"{{workflow_top_n}}"}</code>,{" "}
                  <code>{"{{successful_24h}}"}</code>,{" "}
                  <code>{"{{failures_24h}}"}</code>,{" "}
                  <code>{"{{total_volume_24h}}"}</code>,{" "}
                  <code>{"{{p100_latency_24h}}"}</code>,{" "}
                  <code>{"{{success_rate_24h}}"}</code>,{" "}
                  <code>{"{{failure_rate_24h}}"}</code>
                </span>
              </label>
              <textarea
                className="alerts-textarea alerts-textarea-code"
                rows={3}
                placeholder={
                  "Report: {{report_name}}\nType: {{report_type}}\nGenerated: {{timestamp}}"
                }
                value={reportForm.message_template}
                onChange={(e) =>
                  setReportForm((prev) => ({
                    ...prev,
                    message_template: e.target.value,
                  }))
                }
                spellCheck={false}
              />
            </div>

            <div className="alerts-form-row">
              <label className="alerts-checkbox-label">
                <input
                  type="checkbox"
                  className="alerts-checkbox"
                  checked={reportForm.enabled}
                  onChange={(e) =>
                    setReportForm((prev) => ({
                      ...prev,
                      enabled: e.target.checked,
                    }))
                  }
                />
                <span>Enabled</span>
              </label>
            </div>

            {reportFeedback && (
              <div
                className={`alerts-feedback alerts-feedback-${reportFeedback.type}`}
              >
                {reportFeedback.message}
              </div>
            )}

            <div className="alerts-form-actions">
              <button
                type="submit"
                className="alerts-btn alerts-btn-primary"
                disabled={reportSaving}
              >
                {reportSaving
                  ? "Saving..."
                  : editingReportId
                    ? "Update Report"
                    : "Create Report"}
              </button>
              <button
                type="button"
                className="alerts-btn alerts-btn-secondary"
                onClick={cancelReportForm}
                disabled={reportSaving}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* ─── Reports list ───────────────────────────────────── */}
        {reportsLoading && (
          <div className="alerts-loading-inline">
            <div className="spinner" />
            <span>Loading reports...</span>
          </div>
        )}

        {!reportsLoading &&
          !showReportForm &&
          selectedTenantId &&
          reports.length === 0 && (
            <div className="alerts-empty">
              <p>No scheduled reports configured. Create one to get started.</p>
            </div>
          )}

        {!reportsLoading && reports.length > 0 && (
          <div className="alerts-rules-list">
            {reports.map((report) => (
              <div key={report.id} className="alerts-rule-card">
                <div className="alerts-rule-card-header">
                  <div className="alerts-rule-card-info">
                    <span className="alerts-rule-name">{report.name}</span>
                    <span
                      className={`alerts-rule-status ${report.enabled ? "enabled" : "disabled"}`}
                    >
                      {report.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                  <div className="alerts-rule-card-actions">
                    <button
                      className="alerts-btn alerts-btn-sm"
                      onClick={() => handleTriggerReport(report)}
                      title="Send this report now"
                    >
                      Trigger
                    </button>
                    <button
                      className="alerts-btn alerts-btn-sm"
                      onClick={() => openEditReportForm(report)}
                      title="Edit this report"
                    >
                      Edit
                    </button>
                    <button
                      className="alerts-btn alerts-btn-sm alerts-btn-danger"
                      onClick={() => handleDeleteReport(report.id)}
                      title="Delete this report"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div className="alerts-rule-card-details">
                  <div className="alerts-rule-detail">
                    <span className="alerts-detail-label">Type</span>
                    <span className="alerts-detail-value">
                      {REPORT_TYPE_OPTIONS.find(
                        (o) => o.value === report.report_type,
                      )?.label ?? report.report_type}
                    </span>
                  </div>
                  <div className="alerts-rule-detail">
                    <span className="alerts-detail-label">Frequency</span>
                    <span className="alerts-detail-value">
                      {FREQUENCY_OPTIONS.find(
                        (o) => o.value === report.frequency,
                      )?.label ?? report.frequency}
                      {report.frequency === "weekly" && report.day_of_week
                        ? ` (${DAY_OF_WEEK_OPTIONS.find((d) => d.value === report.day_of_week)?.label ?? report.day_of_week})`
                        : ""}
                      {report.frequency === "monthly" && report.day_of_month
                        ? ` (Day ${report.day_of_month})`
                        : ""}
                    </span>
                  </div>
                  <div className="alerts-rule-detail">
                    <span className="alerts-detail-label">Send Time</span>
                    <span className="alerts-detail-value">
                      {report.send_time ?? "08:00"}
                    </span>
                  </div>
                  <div className="alerts-rule-detail">
                    <span className="alerts-detail-label">Timezone</span>
                    <span className="alerts-detail-value">
                      {report.timezone ?? "UTC"}
                    </span>
                  </div>
                  <div className="alerts-rule-detail">
                    <span className="alerts-detail-label">Channel</span>
                    <span className="alerts-detail-value">
                      {CHANNEL_OPTIONS.find((o) => o.value === report.channel)
                        ?.label ?? report.channel}
                    </span>
                  </div>
                  <div className="alerts-rule-detail">
                    <span className="alerts-detail-label">Recipients</span>
                    <span
                      className="alerts-detail-value alerts-detail-target"
                      title={report.recipients}
                    >
                      {report.recipients}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ──── SECTION 4b: Codefac Pipelines ──────────────────────── */}
      <section className="alerts-section card-surface">
        <div className="section-header">
          <div>
            <h2 className="section-title">Codefac Pipelines</h2>
            <p className="section-subtitle">
              Create Codefac pipeline triggers with custom payloads.
            </p>
          </div>
          {!showCodefacForm && (
            <button
              className="alerts-btn alerts-btn-primary"
              onClick={openCreateCodefacForm}
              disabled={!selectedTenantId}
            >
              + Create Codefac Pipeline
            </button>
          )}
        </div>

        {codefacPipelinesError && (
          <div className="error-banner">
            <span className="error-icon">!</span>
            <span>{codefacPipelinesError}</span>
          </div>
        )}

        {!selectedTenantId && (
          <div className="alerts-empty">
            <p>Select a tenant to manage Codefac pipelines.</p>
          </div>
        )}

        {/* ─── Pipeline form ──────────────────────────────────── */}
        {showCodefacForm && selectedTenantId && (
          <form className="alerts-rule-form" onSubmit={handleSaveCodefac}>
            <div className="alerts-form-row">
              <label className="alerts-label">Pipeline Name</label>
              <input
                type="text"
                className="alerts-input"
                placeholder="e.g. Failure Notification"
                value={codefacForm.name}
                onChange={(e) =>
                  setCodefacForm((prev) => ({ ...prev, name: e.target.value }))
                }
              />
            </div>

            <div className="alerts-form-row">
              <label className="alerts-label">Codefac Pipeline Name</label>
              <input
                type="text"
                className="alerts-input"
                placeholder="e.g. my-codefac-pipeline"
                value={codefacForm.pipeline_name}
                onChange={(e) =>
                  setCodefacForm((prev) => ({
                    ...prev,
                    pipeline_name: e.target.value,
                  }))
                }
              />
              <span className="alerts-label-hint">
                Name of the Codefac pipeline configured in the NotifyHub App
                Store
              </span>
            </div>

            <div className="alerts-form-inline">
              <div className="alerts-form-row">
                <label className="alerts-label">Metric Type</label>
                <select
                  className="alerts-select"
                  value={codefacForm.metric_type}
                  onChange={(e) =>
                    setCodefacForm((prev) => ({
                      ...prev,
                      metric_type: e.target.value,
                    }))
                  }
                >
                  {CODEFAC_METRIC_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {codefacForm.metric_type !== "workflow_failure" && (
                <>
                  <div className="alerts-form-row">
                    <label className="alerts-label">Condition</label>
                    <select
                      className="alerts-select"
                      value={codefacForm.condition_type}
                      onChange={(e) =>
                        setCodefacForm((prev) => ({
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
                      value={codefacForm.threshold}
                      onChange={(e) =>
                        setCodefacForm((prev) => ({
                          ...prev,
                          threshold: e.target.value,
                        }))
                      }
                    />
                  </div>
                </>
              )}
            </div>

            <div className="alerts-form-row">
              <label className="alerts-label">
                Cooldown
                <span className="alerts-label-hint">
                  {" "}
                  — Minimum time before this pipeline can fire again
                </span>
              </label>
              <select
                className="alerts-select"
                value={codefacForm.cooldown}
                onChange={(e) =>
                  setCodefacForm((prev) => ({
                    ...prev,
                    cooldown: e.target.value,
                  }))
                }
              >
                {COOLDOWN_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="alerts-form-row">
              <label className="alerts-label">
                Payload Template (JSON)
                <span className="alerts-label-hint">
                  {" "}
                  — Variables: <code>{"{{rule_name}}"}</code>,{" "}
                  <code>{"{{metric_value}}"}</code>,{" "}
                  <code>{"{{metric_type}}"}</code>,{" "}
                  <code>{"{{condition_type}}"}</code>,{" "}
                  <code>{"{{threshold}}"}</code>, <code>{"{{tenant_id}}"}</code>
                  , <code>{"{{pipeline_name}}"}</code>,{" "}
                  <code>{"{{workflow_id}}"}</code>, <code>{"{{run_id}}"}</code>,{" "}
                  <code>{"{{domain}}"}</code>,{" "}
                  <code>{"{{workflow_history}}"}</code>{" "}
                  (GCS URL when <code>GCS_HISTORY_BUCKET</code> is set; else inline JSON; also{" "}
                  <code>{"{{history}}"}</code>)
                </span>
              </label>
              <textarea
                className="alerts-textarea alerts-textarea-code"
                rows={8}
                placeholder='{"text": "Alert: {{rule_name}}"}'
                value={codefacForm.payload_template}
                onChange={(e) =>
                  setCodefacForm((prev) => ({
                    ...prev,
                    payload_template: e.target.value,
                  }))
                }
                spellCheck={false}
              />
            </div>

            <div className="alerts-form-row">
              <label className="alerts-checkbox-label">
                <input
                  type="checkbox"
                  className="alerts-checkbox"
                  checked={codefacForm.enabled}
                  onChange={(e) =>
                    setCodefacForm((prev) => ({
                      ...prev,
                      enabled: e.target.checked,
                    }))
                  }
                />
                <span>Enabled</span>
              </label>
            </div>

            {codefacFeedback && (
              <div
                className={`alerts-feedback alerts-feedback-${codefacFeedback.type}`}
              >
                {codefacFeedback.message}
              </div>
            )}

            <div className="alerts-form-actions">
              <button
                type="submit"
                className="alerts-btn alerts-btn-primary"
                disabled={codefacSaving}
              >
                {codefacSaving
                  ? "Saving..."
                  : editingCodefacId
                    ? "Update Pipeline"
                    : "Create Pipeline"}
              </button>
              <button
                type="button"
                className="alerts-btn alerts-btn-secondary"
                onClick={cancelCodefacForm}
                disabled={codefacSaving}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* ─── Pipelines list ─────────────────────────────────── */}
        {codefacPipelinesLoading && (
          <div className="alerts-loading-inline">
            <div className="spinner" />
            <span>Loading pipelines...</span>
          </div>
        )}

        {!codefacPipelinesLoading &&
          !showCodefacForm &&
          selectedTenantId &&
          codefacPipelines.length === 0 && (
            <div className="alerts-empty">
              <p>No Codefac pipelines configured. Create one to get started.</p>
            </div>
          )}

        {!codefacPipelinesLoading && codefacPipelines.length > 0 && (
          <div className="alerts-rules-list">
            {codefacPipelines.map((pipeline) => (
              <div key={pipeline.id} className="alerts-rule-card">
                <div className="alerts-rule-card-header">
                  <div className="alerts-rule-card-info">
                    <span className="alerts-rule-name">{pipeline.name}</span>
                    <span
                      className={`alerts-rule-status ${pipeline.enabled ? "enabled" : "paused"}`}
                    >
                      {pipeline.enabled ? "Active" : "Paused"}
                    </span>
                  </div>
                  <div className="alerts-rule-card-actions">
                    <button
                      className={`alerts-btn alerts-btn-sm ${pipeline.enabled ? "" : "alerts-btn-paused"}`}
                      onClick={() => handleToggleCodefacPause(pipeline)}
                      title={
                        pipeline.enabled ? "Pause pipeline" : "Resume pipeline"
                      }
                    >
                      {pipeline.enabled ? "Pause" : "Resume"}
                    </button>
                    <button
                      className="alerts-btn alerts-btn-sm"
                      onClick={() => openEditCodefacForm(pipeline)}
                      title="Edit this pipeline"
                    >
                      Edit
                    </button>
                    <button
                      className="alerts-btn alerts-btn-sm alerts-btn-danger"
                      onClick={() => handleDeleteCodefac(pipeline.id)}
                      title="Delete this pipeline"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div className="alerts-rule-card-details">
                  <div className="alerts-rule-detail">
                    <span className="alerts-detail-label">Pipeline</span>
                    <span
                      className="alerts-detail-value alerts-detail-target"
                      title={pipeline.pipeline_name}
                    >
                      {pipeline.pipeline_name}
                    </span>
                  </div>
                  <div className="alerts-rule-detail">
                    <span className="alerts-detail-label">Metric</span>
                    <span className="alerts-detail-value">
                      {METRIC_OPTIONS.find(
                        (o) => o.value === pipeline.metric_type,
                      )?.label ?? pipeline.metric_type}
                    </span>
                  </div>
                  <div className="alerts-rule-detail">
                    <span className="alerts-detail-label">Condition</span>
                    <span className="alerts-detail-value">
                      {CONDITION_OPTIONS.find(
                        (o) => o.value === pipeline.condition_type,
                      )?.label ?? pipeline.condition_type}{" "}
                      {pipeline.threshold}
                    </span>
                  </div>
                  <div className="alerts-rule-detail">
                    <span className="alerts-detail-label">Cooldown</span>
                    <span className="alerts-detail-value">
                      {secondsToWindow(pipeline.cooldown_seconds) || "5m"}
                    </span>
                  </div>
                  {pipeline.last_triggered_at && (
                    <div className="alerts-rule-detail">
                      <span className="alerts-detail-label">
                        Last Triggered
                      </span>
                      <span className="alerts-detail-value">
                        {formatTimestamp(pipeline.last_triggered_at)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default NotificationsPage;
