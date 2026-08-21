import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import RcaReportModal from "../components/RcaReportModal";
import ColumnVisibilityPicker from "../components/ColumnVisibilityPicker";
import "./NotificationsPage.css";

const PIPELINE_REQUESTS_TAB_STORAGE_KEY = "background-slo.pipeline-requests.tab";
const PIPELINE_IMPACT_STORAGE_KEY =
  "background-slo.pipeline-requests.impact-only";
const PIPELINE_COLUMNS_STORAGE_KEY = "background-slo.pipeline-requests.columns";

const FILTER_OPTIONS = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "processing", label: "Processing" },
  { key: "triggered", label: "Triggered" },
  { key: "skipped_duplicate", label: "Skipped Duplicate" },
  { key: "skipped_cooldown", label: "Skipped Cooldown" },
  { key: "trigger_failed", label: "Trigger Failed" },
  { key: "skipped_inflight", label: "Skipped Inflight" },
];

const REQUEST_SOURCE_TABS = [
  { key: "es", label: "Automatic Pipeline Requests" },
  { key: "manual", label: "Manual Requests" },
];

const MANUAL_FILTER_OPTIONS = [
  { key: "all", label: "All" },
  { key: "sent", label: "Sent" },
  { key: "failed", label: "Failed" },
];

const PIPELINE_COLUMN_OPTIONS = [
  { key: "timestamp", label: "Timestamp" },
  { key: "pipeline", label: "Pipeline" },
  { key: "status", label: "Status" },
  { key: "workflowType", label: "Workflow Type" },
  { key: "error", label: "Error" },
  { key: "customerImpact", label: "Customer Impact" },
  { key: "workflowRun", label: "Workflow / Run" },
  { key: "requestType", label: "Request Type" },
];

function defaultPipelineColumns() {
  return PIPELINE_COLUMN_OPTIONS.map((option) => option.key);
}

const STATUS_LABELS = {
  pending: "Pending",
  processing: "Processing",
  triggered: "Triggered",
  sent: "Sent",
  failed: "Failed",
  skipped_duplicate: "Skipped duplicate",
  skipped_cooldown: "Skipped cooldown",
  trigger_failed: "Trigger failed",
  skipped_inflight: "Skipped inflight",
};

function formatTimestamp(ts) {
  if (!ts) return "";
  try {
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return ts;
    return date.toLocaleString();
  } catch {
    return ts;
  }
}

function clampText(value, maxLength = 140) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

function statusTone(status) {
  switch (status) {
    case "sent":
      return {
        background: "var(--success-bg, rgba(40, 167, 69, 0.12))",
        color: "var(--success, #28a745)",
      };
    case "failed":
    case "trigger_failed":
      return {
        background: "var(--danger-bg, #fce4e4)",
        color: "var(--danger, #d32f2f)",
      };
    case "pending":
    case "processing":
      return {
        background: "var(--surface-secondary)",
        color: "var(--fg-primary)",
      };
    case "triggered":
      return {
        background: "var(--accent-bg)",
        color: "var(--accent)",
      };
    case "skipped_duplicate":
    case "skipped_cooldown":
    case "skipped_inflight":
      return {
        background: "var(--warning-bg)",
        color: "var(--warning-fg)",
      };
    default:
      return {
        background: "var(--surface-secondary)",
        color: "var(--fg-secondary)",
      };
  }
}

function PipelineErrorsPage({ selectedTenantId }) {
  const { authFetch, user } = useAuth();
  const impactStorageKey = user?.email
    ? `${PIPELINE_IMPACT_STORAGE_KEY}:${user.email}`
    : PIPELINE_IMPACT_STORAGE_KEY;
  const [requestSource, setRequestSource] = useState(() => {
    if (typeof window === "undefined") return "es";
    const saved = window.localStorage.getItem(PIPELINE_REQUESTS_TAB_STORAGE_KEY);
    return saved === "manual" ? "manual" : "es";
  });
  const [esFailures, setEsFailures] = useState([]);
  const [manualRequests, setManualRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [impactOnly, setImpactOnly] = useState(() => {
    if (typeof window === "undefined") return false;
    return false;
  });
  const [visibleColumns, setVisibleColumns] = useState(() => {
    if (typeof window === "undefined") {
      return defaultPipelineColumns();
    }
    try {
      const saved = JSON.parse(
        window.localStorage.getItem(PIPELINE_COLUMNS_STORAGE_KEY) || "null",
      );
      return Array.isArray(saved) ? saved : defaultPipelineColumns();
    } catch {
      return defaultPipelineColumns();
    }
  });
  const [selectedRca, setSelectedRca] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!selectedTenantId) {
        if (!cancelled) {
          setEsFailures([]);
          setManualRequests([]);
          setLoading(false);
        }
        return;
      }

      try {
        if (!cancelled) {
          setLoading(true);
          setError(null);
        }
        const [esRes, manualRes] = await Promise.all([
          authFetch(
            `/api/pipeline-requests?tenant_id=${selectedTenantId}&limit=200&offset=0&source=es`,
          ),
          authFetch(
            `/api/pipeline-requests?tenant_id=${selectedTenantId}&limit=200&offset=0&source=manual`,
          ),
        ]);
        if (!esRes.ok) throw new Error(`HTTP error ${esRes.status}`);
        if (!manualRes.ok) throw new Error(`HTTP error ${manualRes.status}`);
        const [esJson, manualJson] = await Promise.all([
          esRes.json(),
          manualRes.json(),
        ]);
        if (!cancelled) {
          setEsFailures(Array.isArray(esJson) ? esJson : (esJson.results ?? []));
          setManualRequests(
            Array.isArray(manualJson) ? manualJson : (manualJson.results ?? []),
          );
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    run();
    const timer = window.setInterval(run, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [authFetch, selectedTenantId]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        PIPELINE_REQUESTS_TAB_STORAGE_KEY,
        requestSource,
      );
    }
  }, [requestSource]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(impactStorageKey);
    setImpactOnly(saved === "true");
  }, [impactStorageKey]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(impactStorageKey, String(impactOnly));
    }
  }, [impactOnly, impactStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(PIPELINE_COLUMNS_STORAGE_KEY);
    if (!saved) {
      const defaults = defaultPipelineColumns();
      setVisibleColumns(defaults);
      window.localStorage.setItem(
        PIPELINE_COLUMNS_STORAGE_KEY,
        JSON.stringify(defaults),
      );
      return;
    }

    try {
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return;
      const allowed = new Set(PIPELINE_COLUMN_OPTIONS.map((option) => option.key));
      const sanitized = parsed.filter((key) => allowed.has(key));
      const nextVisible =
        sanitized.length > 0 ? sanitized : defaultPipelineColumns();
      setVisibleColumns(nextVisible);
      window.localStorage.setItem(
        PIPELINE_COLUMNS_STORAGE_KEY,
        JSON.stringify(nextVisible),
      );
    } catch {
      const defaults = defaultPipelineColumns();
      setVisibleColumns(defaults);
      window.localStorage.setItem(
        PIPELINE_COLUMNS_STORAGE_KEY,
        JSON.stringify(defaults),
      );
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        PIPELINE_COLUMNS_STORAGE_KEY,
        JSON.stringify(visibleColumns),
      );
    }
  }, [visibleColumns]);

  const showColumn = (key) => visibleColumns.includes(key);

  const toggleColumn = (key) => {
    setVisibleColumns((current) => {
      const isVisible = current.includes(key);
      if (isVisible && current.length === 1) {
        return current;
      }
      return isVisible
        ? current.filter((columnKey) => columnKey !== key)
        : [...current, key];
    });
  };

  const resetColumns = () => {
    setVisibleColumns(defaultPipelineColumns());
  };

  const activeRows = requestSource === "manual" ? manualRequests : esFailures;
  const activeFilterOptions =
    requestSource === "manual" ? MANUAL_FILTER_OPTIONS : FILTER_OPTIONS;

  const searchValue = search.trim().toLowerCase();
  const filteredFailures = activeRows.filter((failure) => {
    if (filter !== "all" && failure.status !== filter) {
      return false;
    }
    if (impactOnly && !failure.has_customer_impact) {
      return false;
    }
    if (!searchValue) {
      return true;
    }
    return [
      failure.pipeline_name,
      failure.workflow_type,
      failure.workflow_id,
      failure.run_id,
      failure.error_text,
      failure.error_message,
      failure.customer_impact_summary,
      failure.customer_impact_details,
      failure.rca_summary,
      failure.matched_workflow_id,
      failure.matched_run_id,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(searchValue));
  });

  const summary = activeRows.reduce(
    (acc, failure) => {
      acc.total += 1;
      if (requestSource === "manual") {
        if (failure.status === "sent") acc.sent += 1;
        if (failure.status === "failed") acc.failed += 1;
      } else {
        if (failure.status === "triggered") acc.triggered += 1;
        if (failure.status === "skipped_duplicate") acc.skippedDuplicate += 1;
        if (failure.status === "skipped_cooldown") acc.skippedCooldown += 1;
        if (failure.status === "trigger_failed") acc.failed += 1;
        if (failure.status === "processing") acc.processing += 1;
      }
      return acc;
    },
    {
      total: 0,
      triggered: 0,
      sent: 0,
      skippedDuplicate: 0,
      skippedCooldown: 0,
      failed: 0,
      processing: 0,
    },
  );

  return (
    <div className="alerts-page">
      {selectedRca && (
        <RcaReportModal record={selectedRca} onClose={() => setSelectedRca(null)} />
      )}
      <section className="alerts-section card-surface">
        <div className="section-header">
          <div>
            <h2 className="section-title">Pipeline Requests</h2>
            <p className="section-subtitle">
              {requestSource === "manual"
                ? "Review manually triggered pipeline requests from the failures page."
                : "Review workflow failure requests, delivery status, and requests skipped because the same workflow type and error were already handled."}
            </p>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 12,
            padding: "0 18px 18px",
            flexWrap: "wrap",
          }}
        >
          {REQUEST_SOURCE_TABS.map((tab) => (
            <button
              key={tab.key}
              className={`filter-chip${requestSource === tab.key ? " active" : ""}`}
              onClick={() => {
                setRequestSource(tab.key);
                setFilter("all");
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 12,
            padding: "18px",
            borderBottom: "1px solid var(--separator)",
          }}
        >
          {(requestSource === "manual"
            ? [
                { label: "Total Requests", value: summary.total },
                { label: "Sent", value: summary.sent },
                { label: "Failed", value: summary.failed },
              ]
            : [
                { label: "Total Requests", value: summary.total },
                { label: "Triggered", value: summary.triggered },
                { label: "Skipped Duplicate", value: summary.skippedDuplicate },
                { label: "Skipped Cooldown", value: summary.skippedCooldown },
                { label: "Processing", value: summary.processing },
                { label: "Trigger Failed", value: summary.failed },
              ]).map((item) => (
            <div key={item.label} className="pipeline-summary-card">
              <span className="pipeline-summary-label">{item.label}</span>
              <span className="pipeline-summary-value">{item.value}</span>
            </div>
          ))}
        </div>

        <div
          className="failures-filters"
          style={{
            padding: "14px 18px",
            display: "flex",
            gap: "12px",
            alignItems: "center",
            flexWrap: "wrap",
            background: "var(--surface-secondary)",
            borderBottom: "1px solid var(--separator)",
          }}
        >
          <span className="filter-label">Status</span>
          {activeFilterOptions.map((option) => (
            <button
              key={option.key}
              className={`filter-chip${filter === option.key ? " active" : ""}`}
              onClick={() => setFilter(option.key)}
            >
              {option.label}
            </button>
          ))}
          <button
            className={`filter-chip${impactOnly ? " active" : ""}`}
            onClick={() => setImpactOnly((current) => !current)}
          >
            Customer impact only
          </button>
          <ColumnVisibilityPicker
            options={PIPELINE_COLUMN_OPTIONS}
            visibleKeys={visibleColumns}
            onToggle={toggleColumn}
            onReset={resetColumns}
          />
          <input
            type="search"
            className="alerts-input"
            placeholder={
              requestSource === "manual"
                ? "Search pipeline, workflow type, error, workflow id..."
                : "Search workflow type, error, workflow id..."
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ minWidth: 280, maxWidth: 420 }}
          />
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
            <span>Loading pipeline requests...</span>
          </div>
        )}

        {!loading && !error && filteredFailures.length === 0 && (
          <div className="alerts-empty">
            <p>No pipeline requests found.</p>
          </div>
        )}

        {!loading && filteredFailures.length > 0 && (
          <div className="alerts-history-table-wrap">
            <table className="alerts-history-table">
              <thead>
                <tr>
                  {showColumn("timestamp") && <th>Timestamp</th>}
                  {showColumn("pipeline") && <th>Pipeline</th>}
                  {showColumn("status") && <th>Status</th>}
                  {showColumn("workflowType") && <th>Workflow Type</th>}
                  {showColumn("customerImpact") && <th>Customer Impact</th>}
                  {showColumn("error") && <th>Error</th>}
                  {showColumn("workflowRun") && <th>Workflow / Run</th>}
                  {showColumn("requestType") && (
                    <th>{requestSource === "manual" ? "Request Type" : "Matched Request"}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filteredFailures.map((failure) => {
                  const tone = statusTone(failure.status);
                  return (
                    <tr key={failure.id}>
                      {showColumn("timestamp") && (
                        <td className="alerts-history-cell-time">
                          {formatTimestamp(
                            failure.processed_at ||
                              failure.triggered_at ||
                              failure.updated_at,
                          )}
                        </td>
                      )}
                      {showColumn("pipeline") && (
                        <td style={{ fontSize: 12 }}>
                          <div>{failure.pipeline_name || "Unknown pipeline"}</div>
                          {failure.delivery_status && (
                            <div
                              style={{
                                fontSize: 11,
                                color: "var(--fg-tertiary)",
                                marginTop: 4,
                              }}
                            >
                              Delivery: {failure.delivery_status}
                            </div>
                          )}
                        </td>
                      )}
                      {showColumn("status") && (
                        <td>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "2px 8px",
                              borderRadius: 10,
                              fontSize: 10,
                              fontWeight: 600,
                              textTransform: "uppercase",
                              background: tone.background,
                              color: tone.color,
                            }}
                          >
                            {STATUS_LABELS[failure.status] || failure.status}
                          </span>
                        </td>
                      )}
                      {showColumn("workflowType") && (
                        <td style={{ fontSize: 12, minWidth: 220 }}>
                          <div
                            style={{
                              fontSize: 11.5,
                              whiteSpace: "normal",
                              overflowWrap: "anywhere",
                              wordBreak: "break-word",
                              lineHeight: 1.45,
                            }}
                          >
                            {failure.workflow_type || "unknown"}
                          </div>
                          <div
                            style={{
                              marginTop: 4,
                              color: "var(--fg-tertiary)",
                              fontSize: 11,
                            }}
                          >
                            Source: {failure.source_status || "unknown"}
                          </div>
                          {requestSource === "es" && failure.trigger_attempts > 0 && (
                            <div
                              style={{
                                marginTop: 4,
                                color: "var(--fg-tertiary)",
                                fontSize: 11,
                              }}
                            >
                              Attempts: {failure.trigger_attempts}
                            </div>
                          )}
                        </td>
                      )}
                      {showColumn("customerImpact") && (
                        <td style={{ fontSize: 12, minWidth: 250 }}>
                          {failure.has_rca ? (
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 6,
                                alignItems: "flex-start",
                              }}
                            >
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  minHeight: 20,
                                  padding: "0 8px",
                                  borderRadius: 999,
                                  background: failure.has_customer_impact
                                    ? "color-mix(in srgb, var(--warning-bg) 72%, var(--surface))"
                                    : "var(--surface-secondary)",
                                  color: failure.has_customer_impact
                                    ? "var(--warning-fg)"
                                    : "var(--fg-secondary)",
                                  fontSize: 10,
                                  fontWeight: 700,
                                  textTransform: "uppercase",
                                  letterSpacing: "0.05em",
                                }}
                              >
                                {failure.has_customer_impact
                                  ? "Customer impact"
                                  : "No impact noted"}
                              </span>
                              <div
                                title={
                                  failure.customer_impact_details ||
                                  failure.rca_summary ||
                                  ""
                                }
                                style={{
                                  color: "var(--fg-secondary)",
                                  lineHeight: 1.45,
                                  whiteSpace: "normal",
                                  wordBreak: "break-word",
                                }}
                              >
                                {failure.customer_impact_details ||
                                  failure.customer_impact_summary ||
                                  failure.rca_summary ||
                                  "Open the RCA report for details."}
                              </div>
                              <div
                                style={{
                                  display: "flex",
                                  flexWrap: "wrap",
                                  gap: 8,
                                }}
                              >
                                <button
                                  type="button"
                                  className="filter-chip"
                                  style={{
                                    height: 24,
                                    padding: "0 10px",
                                    borderRadius: 12,
                                  }}
                                  onClick={() => setSelectedRca(failure)}
                                >
                                  View RCA
                                </button>
                                {failure.open_mr_url && (
                                  <a
                                    className="filter-chip"
                                    href={failure.open_mr_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{
                                      height: 24,
                                      padding: "0 10px",
                                      borderRadius: 12,
                                      display: "inline-flex",
                                      alignItems: "center",
                                      textDecoration: "none",
                                    }}
                                  >
                                    {failure.open_mr_label &&
                                    failure.open_mr_label !== failure.open_mr_url
                                      ? failure.open_mr_label
                                      : "Open MR/PR"}
                                  </a>
                                )}
                              </div>
                            </div>
                          ) : (
                            <span style={{ color: "var(--fg-tertiary)" }}>
                              No RCA yet
                            </span>
                          )}
                        </td>
                      )}
                      {showColumn("error") && (
                        <td style={{ fontSize: 12, minWidth: 240 }}>
                          <div
                            title={failure.error_text || "Unknown error"}
                            style={{
                              display: "-webkit-box",
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: "vertical",
                              overflow: "hidden",
                              whiteSpace: "normal",
                              lineHeight: 1.4,
                            }}
                          >
                            {clampText(failure.error_text || "Unknown error", 220)}
                          </div>
                          {failure.error_message && (
                            <div
                              title={failure.error_message}
                              style={{
                                fontSize: 11,
                                color: "var(--danger, #d32f2f)",
                                marginTop: 4,
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                                whiteSpace: "normal",
                                lineHeight: 1.35,
                              }}
                            >
                              {clampText(failure.error_message, 180)}
                            </div>
                          )}
                        </td>
                      )}
                      {showColumn("workflowRun") && (
                        <td style={{ fontSize: 12 }}>
                          <div>
                            <code
                              style={{
                                fontSize: 10,
                                fontFamily: '"SF Mono", monospace',
                              }}
                            >
                              {failure.workflow_id || "-"}
                            </code>
                          </div>
                          <div
                            style={{
                              marginTop: 4,
                              color: "var(--fg-tertiary)",
                              fontSize: 11,
                            }}
                          >
                            Run:{" "}
                            <code
                              style={{
                                fontSize: 10,
                                fontFamily: '"SF Mono", monospace',
                              }}
                            >
                              {failure.run_id || "-"}
                            </code>
                          </div>
                        </td>
                      )}
                      {showColumn("requestType") && (
                        <td style={{ fontSize: 12 }}>
                          {requestSource === "manual" ? (
                            <span style={{ color: "var(--fg-tertiary)" }}>
                              Manual trigger
                            </span>
                          ) : failure.matched_workflow_id ? (
                            <>
                              <div>
                                <code
                                  style={{
                                    fontSize: 10,
                                    fontFamily: '"SF Mono", monospace',
                                  }}
                                >
                                  {failure.matched_workflow_id}
                                </code>
                              </div>
                              <div
                                style={{
                                  marginTop: 4,
                                  color: "var(--fg-tertiary)",
                                  fontSize: 11,
                                }}
                              >
                                Run:{" "}
                                <code
                                  style={{
                                    fontSize: 10,
                                    fontFamily: '"SF Mono", monospace',
                                  }}
                                >
                                  {failure.matched_run_id || "-"}
                                </code>
                              </div>
                              {failure.matched_triggered_at && (
                                <div
                                  style={{
                                    marginTop: 4,
                                    color: "var(--fg-tertiary)",
                                    fontSize: 11,
                                  }}
                                >
                                  Triggered at{" "}
                                  {formatTimestamp(failure.matched_triggered_at)}
                                </div>
                              )}
                            </>
                          ) : (
                            <span style={{ color: "var(--fg-tertiary)" }}>-</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default PipelineErrorsPage;
