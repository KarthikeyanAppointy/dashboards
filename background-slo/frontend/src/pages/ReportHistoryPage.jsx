import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../auth/AuthContext";
import "./NotificationsPage.css";

const METRIC_LABELS = {
  slo_summary: "SLO Summary",
  failure_report: "Failure Report",
  ses_delivery_report: "SES Delivery Report",
  workflow_failure: "Workflow Failure",
};

function ReportHistoryPage({ selectedTenantId }) {
  const { authFetch } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all"); // "all", "report", "pipeline", "alert"

  const qs = useCallback(
    (extra) => {
      if (!selectedTenantId) return "";
      const params = new URLSearchParams({
        tenant_id: selectedTenantId,
        limit: "200",
        offset: "0",
      });
      if (extra) {
        Object.entries(extra).forEach(([k, v]) => {
          if (v !== undefined && v !== null) params.set(k, v);
        });
      }
      return `?${params.toString()}`;
    },
    [selectedTenantId],
  );

  const fetchHistory = useCallback(async () => {
    if (!selectedTenantId) return;
    try {
      setLoading(true);
      setError(null);
      const res = await authFetch(`/api/alerts/history${qs()}`);
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const json = await res.json();
      const entries = Array.isArray(json)
        ? json
        : (json.results ?? json.history ?? []);
      // Include all entries (alerts, reports, and pipelines)
      setData(entries);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [authFetch, qs, selectedTenantId]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

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

  const filteredData = data
    ? filter === "all"
      ? data
      : filter === "alert"
        ? data.filter(
            (e) => e.alert_rule_id != null && e.channel !== "pipeline",
          )
        : data.filter((e) => e.channel === filter)
    : [];

  return (
    <div className="alerts-page">
      <section className="alerts-section card-surface">
        <div className="section-header">
          <div>
            <h2 className="section-title">Notification History</h2>
            <p className="section-subtitle">
              History of triggered alerts, scheduled reports, and pipeline
              executions.
            </p>
          </div>
        </div>

        <div
          className="failures-filters"
          style={{
            padding: "10px 18px",
            display: "flex",
            gap: "12px",
            alignItems: "center",
            background: "var(--surface-secondary)",
            borderBottom: "1px solid var(--separator)",
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              color: "var(--fg-secondary)",
            }}
          >
            Filter
          </span>
          {["all", "alert", "report", "pipeline"].map((f) => (
            <button
              key={f}
              className={`filter-chip${filter === f ? " active" : ""}`}
              onClick={() => setFilter(f)}
              style={{
                height: 26,
                padding: "0 10px",
                borderRadius: 13,
                border: "1px solid var(--border)",
                fontSize: 11,
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "inherit",
                background: filter === f ? "var(--accent)" : "var(--surface)",
                color:
                  filter === f ? "var(--accent-fg)" : "var(--fg-secondary)",
                transition: "all 0.12s ease",
              }}
            >
              {f === "all"
                ? "All"
                : f === "alert"
                  ? "Alerts"
                  : f === "report"
                    ? "Scheduled Reports"
                    : "Pipelines"}
            </button>
          ))}
        </div>

        {error && (
          <div className="error-banner">
            <span className="error-icon">!</span>
            <span>{error}</span>
          </div>
        )}

        {loading && (
          <div className="alerts-loading-inline">
            <div className="spinner" />
            <span>Loading history...</span>
          </div>
        )}

        {!loading && !error && filteredData.length === 0 && (
          <div className="alerts-empty">
            <p>No notification history found.</p>
          </div>
        )}

        {!loading && filteredData.length > 0 && (
          <div className="alerts-history-table-wrap">
            <table className="alerts-history-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Type</th>
                  <th>Details</th>
                  <th>Recipient / Pipeline</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredData.map((entry, idx) => (
                  <tr key={entry.id ?? idx}>
                    <td className="alerts-history-cell-time">
                      {formatTimestamp(entry.sent_at)}
                    </td>
                    <td>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 8px",
                          borderRadius: 10,
                          fontSize: 10,
                          fontWeight: 600,
                          textTransform: "uppercase",
                          background:
                            entry.channel === "report"
                              ? "var(--accent-bg)"
                              : entry.alert_rule_id != null &&
                                  entry.channel !== "pipeline"
                                ? "var(--danger-bg, #fce4e4)"
                                : "var(--warning-bg)",
                          color:
                            entry.channel === "report"
                              ? "var(--accent)"
                              : entry.alert_rule_id != null &&
                                  entry.channel !== "pipeline"
                                ? "var(--danger, #d32f2f)"
                                : "var(--warning-fg)",
                        }}
                      >
                        {entry.channel === "report"
                          ? "Report"
                          : entry.alert_rule_id != null &&
                              entry.channel !== "pipeline"
                            ? "Alert"
                            : "Pipeline"}
                      </span>
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {entry.channel === "report" ? (
                        <span>
                          {METRIC_LABELS[entry.metric_type] ||
                            entry.metric_type}
                          {entry.tile_id &&
                            ` (#${entry.tile_id.replace("report-", "")})`}
                        </span>
                      ) : entry.channel === "pipeline" ? (
                        <span>
                          {entry.workflow_id ? (
                            <>
                              <code
                                style={{
                                  fontSize: 10,
                                  fontFamily: '"SF Mono", monospace',
                                }}
                              >
                                {entry.workflow_id}
                              </code>
                              {entry.run_id && (
                                <span
                                  style={{
                                    color: "var(--fg-tertiary)",
                                    fontSize: 10,
                                  }}
                                >
                                  {" "}
                                  /{entry.run_id.substring(0, 8)}
                                </span>
                              )}
                            </>
                          ) : (
                            METRIC_LABELS[entry.metric_type] ||
                            entry.metric_type ||
                            "-"
                          )}
                        </span>
                      ) : (
                        <span>
                          {entry.alert_rule_id
                            ? `${METRIC_LABELS[entry.metric_type] || entry.metric_type} (threshold: ${entry.condition_type || ""} ${entry.threshold || ""})`
                            : METRIC_LABELS[entry.metric_type] ||
                              entry.metric_type ||
                              "-"}
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: 11, color: "var(--fg-secondary)" }}>
                      {entry.recipient || "-"}
                    </td>
                    <td>
                      <span
                        className={`alerts-history-status ${
                          entry.status === "sent" ||
                          entry.status === "delivered"
                            ? "history-status-sent"
                            : entry.status === "failed"
                              ? "history-status-failed"
                              : ""
                        }`}
                      >
                        {entry.status ?? "unknown"}
                      </span>
                      {entry.error_message && entry.error_message !== "" && (
                        <span
                          style={{
                            display: "block",
                            fontSize: 10,
                            color: "var(--danger)",
                            marginTop: 2,
                          }}
                        >
                          {entry.error_message}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default ReportHistoryPage;
