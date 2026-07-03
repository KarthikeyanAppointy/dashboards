import { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "../auth/AuthContext";
import WorkflowHistoryModal from "./WorkflowHistoryModal";
import RcaReportModal from "./RcaReportModal";
import ColumnVisibilityPicker from "./ColumnVisibilityPicker";
import "./RecentFailures.css";

const STATUS_OPTIONS = ["Failed", "TimedOut"];
const IMPACT_FILTER_STORAGE_KEY = "background-slo.recent-failures.impact-only";
const COLUMN_STORAGE_KEY = "background-slo.recent-failures.columns";
const RECENT_FAILURE_COLUMN_OPTIONS = [
  { key: "triggerAction", label: "Trigger Action" },
  { key: "workflowRun", label: "Workflow / Run" },
  { key: "failureReason", label: "Failure Reason" },
  { key: "customerImpact", label: "Customer Impact" },
  { key: "workflowType", label: "Workflow Type" },
  { key: "tasklist", label: "Tasklist" },
  { key: "status", label: "Status" },
  { key: "closeTime", label: "Close Time" },
  { key: "triggered", label: "Triggered" },
  { key: "lastPipeline", label: "Last Pipeline" },
];

function usesCustomerPreset(persona, role) {
  const normalizedPersona = String(persona || "").toLowerCase();
  if (normalizedPersona === "qa" || normalizedPersona === "ceam") {
    return true;
  }
  const normalizedRole = String(role || "").toLowerCase();
  if (normalizedRole === "admin" || normalizedRole === "user") {
    return false;
  }
  return normalizedPersona !== "developer" && normalizedPersona !== "";
}

function defaultRecentFailureColumns(persona, role, canShowPipelineColumns) {
  if (usesCustomerPreset(persona, role)) {
    return [
      "failureReason",
      "customerImpact",
      "workflowType",
      "status",
      "closeTime",
    ];
  }

  const columns = [
    "workflowRun",
    "failureReason",
    "customerImpact",
    "workflowType",
    "tasklist",
    "status",
    "closeTime",
  ];
  if (canShowPipelineColumns) {
    columns.unshift("triggerAction");
    columns.push("triggered", "lastPipeline");
  }
  return columns;
}

function recentFailureKey(workflowId, runId) {
  return `${workflowId || ""}::${runId || ""}`;
}

function pipelineStatusMeta(status) {
  switch (status) {
    case "triggered":
    case "sent":
      return {
        icon: "✓",
        color: "var(--success)",
        title: "Pipeline triggered successfully",
      };
    case "skipped_duplicate":
    case "skipped_cooldown":
    case "skipped_inflight":
      return {
        icon: "↷",
        color: "var(--warning-fg)",
        title: "Pipeline request skipped",
      };
    case "trigger_failed":
    case "failed":
      return {
        icon: "✕",
        color: "var(--danger)",
        title: "Pipeline trigger failed",
      };
    case "processing":
      return {
        icon: "…",
        color: "var(--fg-secondary)",
        title: "Pipeline request in progress",
      };
    default:
      return null;
  }
}

function getStatusClass(status) {
  if (status === "Failed" || status === "failed") return "status-failed";
  if (status === "TimedOut" || status === "timed_out" || status === "Timed Out")
    return "status-timedout";
  return "status-default";
}

function TasklistDropdown({
  availableTasklists,
  tasklistFilter,
  onTasklistFilterChange,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered = availableTasklists.filter((tl) =>
    tl.toLowerCase().includes(search.toLowerCase()),
  );

  const toggle = (tl) => {
    const next = tasklistFilter.includes(tl)
      ? tasklistFilter.filter((t) => t !== tl)
      : [...tasklistFilter, tl];
    onTasklistFilterChange(next);
  };

  const selectedCount = tasklistFilter.length;
  const label =
    selectedCount === 0
      ? "All tasklists"
      : selectedCount === 1
        ? tasklistFilter[0]
        : `${selectedCount} tasklists`;

  return (
    <div className="tl-dropdown-container" ref={containerRef}>
      <button
        className={`tl-dropdown-trigger${open ? " open" : ""}${selectedCount > 0 ? " has-selection" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
        >
          <rect
            x="1"
            y="2"
            width="10"
            height="1.5"
            rx="0.75"
            fill="currentColor"
          />
          <rect
            x="1"
            y="5.25"
            width="7"
            height="1.5"
            rx="0.75"
            fill="currentColor"
          />
          <rect
            x="1"
            y="8.5"
            width="5"
            height="1.5"
            rx="0.75"
            fill="currentColor"
          />
        </svg>
        <span className="tl-dropdown-label">{label}</span>
        {selectedCount > 0 && (
          <span className="tl-dropdown-count">{selectedCount}</span>
        )}
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          aria-hidden="true"
          className={`tl-dropdown-chevron${open ? " open" : ""}`}
        >
          <path
            d="M2 3.5L5 6.5L8 3.5"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          className="tl-dropdown-panel"
          role="listbox"
          aria-multiselectable="true"
        >
          {availableTasklists.length > 6 && (
            <div className="tl-dropdown-search">
              <input
                type="text"
                placeholder="Filter tasklists\u2026"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </div>
          )}

          <div className="tl-dropdown-list">
            {filtered.length === 0 ? (
              <div className="tl-dropdown-empty">No matches</div>
            ) : (
              filtered.map((tl) => {
                const checked = tasklistFilter.includes(tl);
                return (
                  <label
                    key={tl}
                    className={`tl-dropdown-item${checked ? " checked" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(tl)}
                    />
                    <span className="tl-dropdown-item-name">{tl}</span>
                  </label>
                );
              })
            )}
          </div>

          {selectedCount > 0 && (
            <div className="tl-dropdown-footer">
              <button
                className="tl-dropdown-clear"
                onClick={() => {
                  onTasklistFilterChange([]);
                  setOpen(false);
                }}
              >
                Clear selection
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const FailuresAlertBell = ({ active, onClick, title }) => (
  <button
    className={`tl-alert-btn${active ? " active" : ""}`}
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    title={title}
    aria-label={title}
  >
    <svg
      width="13"
      height="13"
      viewBox="0 0 15 15"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M7.5 1.5C4.5 1.5 2.5 4 2.5 7V10L1 12H14L12.5 10V7C12.5 4 10.5 1.5 7.5 1.5Z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 12C9.5 13.5 8.5 14 7.5 14C6.5 14 5.5 13.5 5.5 12"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
      {active && (
        <circle cx="11.5" cy="3.5" r="2" fill="var(--accent)" stroke="none" />
      )}
    </svg>
  </button>
);

function RecentFailures({
  failures,
  limit,
  onLimitChange,
  statusFilter,
  onStatusFilterChange,
  tasklistFilter,
  onTasklistFilterChange,
  availableTasklists,
  offset,
  onOffsetChange,
  totalFailed,
  activeAlerts,
  onAlertSetup,
  codefacPipelines,
  onTriggerPipeline,
  selectedTenantId,
  selectedTenant,
  notificationsEnabled,
  userPersona,
  userRole,
}) {
  const { authFetch } = useAuth();
  const [historyWorkflow, setHistoryWorkflow] = useState(null);
  const [rcaWorkflow, setRcaWorkflow] = useState(null);
  const pageSize = limit || 20;
  const currentPage = Math.floor(offset / pageSize) + 1;
  const totalPages = Math.ceil(totalFailed / pageSize);
  const hasPrevPage = offset > 0;
  const hasNextPage = offset + pageSize < totalFailed;

  const [selectedPipelineId, setSelectedPipelineId] = useState(
    codefacPipelines && codefacPipelines.length > 0
      ? String(codefacPipelines[0].id)
      : "",
  );
  const [triggering, setTriggering] = useState({});
  const [triggeredMap, setTriggeredMap] = useState({});
  const [impactOnly, setImpactOnly] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(IMPACT_FILTER_STORAGE_KEY) === "true";
  });
  const canShowPipelineColumns =
    codefacPipelines && codefacPipelines.length > 0 && notificationsEnabled;
  const [visibleColumns, setVisibleColumns] = useState(() => {
    if (typeof window === "undefined") {
      return defaultRecentFailureColumns("developer", "user", false);
    }
    try {
      const saved = JSON.parse(
        window.localStorage.getItem(COLUMN_STORAGE_KEY) || "null",
      );
      return Array.isArray(saved)
        ? saved
        : defaultRecentFailureColumns("developer", "user", false);
    } catch {
      return defaultRecentFailureColumns("developer", "user", false);
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const requiresImpactDefault = usesCustomerPreset(userPersona, userRole);
    const saved = window.localStorage.getItem(IMPACT_FILTER_STORAGE_KEY);
    if (requiresImpactDefault && saved !== "true") {
      setImpactOnly(true);
      window.localStorage.setItem(IMPACT_FILTER_STORAGE_KEY, "true");
      return;
    }
    if (!requiresImpactDefault && saved !== null) {
      setImpactOnly(saved === "true");
    }
  }, [userPersona, userRole]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        IMPACT_FILTER_STORAGE_KEY,
        String(impactOnly),
      );
    }
  }, [impactOnly]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(COLUMN_STORAGE_KEY);
    if (!saved) {
      const defaults = defaultRecentFailureColumns(
        userPersona || "developer",
        userRole || "user",
        Boolean(canShowPipelineColumns),
      );
      setVisibleColumns(defaults);
      window.localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(defaults));
      return;
    }

    try {
      const parsed = JSON.parse(saved);
      if (!Array.isArray(parsed)) return;
      const allowed = new Set(
        RECENT_FAILURE_COLUMN_OPTIONS.filter((option) =>
          option.key === "triggerAction" ||
          option.key === "triggered" ||
          option.key === "lastPipeline"
            ? canShowPipelineColumns
            : true,
        ).map((option) => option.key),
      );
      const sanitized = parsed.filter((key) => allowed.has(key));
      const nextVisible =
        sanitized.length > 0
          ? sanitized
          : defaultRecentFailureColumns(
              userPersona || "developer",
              userRole || "user",
              Boolean(canShowPipelineColumns),
            );
      setVisibleColumns(nextVisible);
      window.localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(nextVisible));
    } catch {
      const defaults = defaultRecentFailureColumns(
        userPersona || "developer",
        userRole || "user",
        Boolean(canShowPipelineColumns),
      );
      setVisibleColumns(defaults);
      window.localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(defaults));
    }
  }, [canShowPipelineColumns, userPersona, userRole]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(
        COLUMN_STORAGE_KEY,
        JSON.stringify(visibleColumns),
      );
    }
  }, [visibleColumns]);

  const availableColumnOptions = RECENT_FAILURE_COLUMN_OPTIONS.filter((option) =>
    option.key === "triggerAction" ||
    option.key === "triggered" ||
    option.key === "lastPipeline"
      ? canShowPipelineColumns
      : true,
  );
  const showColumn = (key) => visibleColumns.includes(key);
  const emptyColSpan =
    availableColumnOptions.filter((option) => showColumn(option.key)).length || 1;

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
    setVisibleColumns(
      defaultRecentFailureColumns(
        userPersona || "developer",
        userRole || "user",
        Boolean(canShowPipelineColumns),
      ),
    );
  };

  const filteredFailures = (failures || []).filter((f) => {
    const statusMatch =
      statusFilter.length === 0 ||
      statusFilter.length === 2 ||
      statusFilter.includes(f.status);
    const tasklistMatch =
      tasklistFilter.length === 0 || tasklistFilter.includes(f.tasklist);
    const impactMatch = !impactOnly || f.has_customer_impact;
    return statusMatch && tasklistMatch && impactMatch;
  });

  // Sync selectedPipelineId when pipelines change
  useEffect(() => {
    if (codefacPipelines && codefacPipelines.length > 0) {
      const stillExists = codefacPipelines.find(
        (p) => String(p.id) === selectedPipelineId,
      );
      if (!stillExists) {
        setSelectedPipelineId(String(codefacPipelines[0].id));
      }
    } else {
      setSelectedPipelineId("");
    }
  }, [codefacPipelines]);

  // Fetch pipeline request history to populate Triggered/Last Pipeline columns
  useEffect(() => {
    if (!selectedTenantId) return;
    let cancelled = false;
    const fetchHistory = async () => {
      try {
        const [esRes, manualRes] = await Promise.all([
          authFetch(
            `/api/pipeline-requests?tenant_id=${selectedTenantId}&limit=500&offset=0&source=es`,
          ),
          authFetch(
            `/api/pipeline-requests?tenant_id=${selectedTenantId}&limit=500&offset=0&source=manual`,
          ),
        ]);
        if (!esRes.ok || !manualRes.ok) return;
        const [esJson, manualJson] = await Promise.all([
          esRes.json(),
          manualRes.json(),
        ]);
        const esEntries = Array.isArray(esJson) ? esJson : (esJson.results ?? []);
        const manualEntries = Array.isArray(manualJson)
          ? manualJson
          : (manualJson.results ?? []);
        if (cancelled) return;

        // Build map of workflow_id+run_id -> latest status entry.
        const newMap = {};
        for (const entry of esEntries) {
          if (!entry.workflow_id || !entry.run_id) continue;
          const key = recentFailureKey(entry.workflow_id, entry.run_id);
          const tsRaw = entry.processed_at || entry.triggered_at || entry.updated_at;
          const ts = tsRaw ? new Date(tsRaw).toLocaleTimeString() : "";
          const currentStamp = tsRaw ? new Date(tsRaw).getTime() : 0;
          if (!newMap[key] || currentStamp >= (newMap[key].stamp || 0)) {
            newMap[key] = {
              status: entry.status,
              pipeline: entry.pipeline_name || "",
              time: ts,
              stamp: currentStamp,
              source: "automatic",
            };
          }
        }
        for (const entry of manualEntries) {
          if (!entry.workflow_id || !entry.run_id) continue;
          const key = recentFailureKey(entry.workflow_id, entry.run_id);
          const tsRaw = entry.sent_at;
          const ts = tsRaw ? new Date(tsRaw).toLocaleTimeString() : "";
          const currentStamp = tsRaw ? new Date(tsRaw).getTime() : 0;
          if (!newMap[key] || currentStamp >= (newMap[key].stamp || 0)) {
            newMap[key] = {
              status: entry.status,
              pipeline: entry.pipeline_name || entry.recipient || "",
              time: ts,
              stamp: currentStamp,
              source: "manual",
            };
          }
        }
        setTriggeredMap(newMap);
      } catch {
        // ignore
      }
    };
    fetchHistory();
    return () => {
      cancelled = true;
    };
  }, [authFetch, selectedTenantId]);

  const toggleStatus = (status) => {
    const newFilter = statusFilter.includes(status)
      ? statusFilter.filter((s) => s !== status)
      : [...statusFilter, status];
    onStatusFilterChange(newFilter);
  };

  const canViewHistory =
    selectedTenant?.cadence_web_url && selectedTenantId;

  const handleRowClick = (workflow, e) => {
    if (e.target.closest("button")) return;
    if (!canViewHistory) return;
    setHistoryWorkflow(workflow);
  };

  const handleTrigger = async (workflow) => {
    if (!selectedPipelineId) return;
    const wfKey = workflow.workflow_id || workflow.run_id;
    const wfKeyExact = recentFailureKey(workflow.workflow_id, workflow.run_id);
    setTriggering((prev) => ({ ...prev, [wfKey]: true }));
    try {
      const pipeline = codefacPipelines.find(
        (p) => String(p.id) === selectedPipelineId,
      );
      await onTriggerPipeline(Number(selectedPipelineId), workflow);
      const now = new Date().toLocaleTimeString();
      setTriggeredMap((prev) => ({
        ...prev,
        [wfKeyExact]: {
          status: "sent",
          pipeline: pipeline ? pipeline.name : "",
          time: now,
          stamp: Date.now(),
          source: "manual",
        },
      }));
    } catch {
      // ignore
    } finally {
      setTriggering((prev) => ({ ...prev, [wfKey]: false }));
    }
  };

  return (
    <div className="failures-section">
      {historyWorkflow && (
        <WorkflowHistoryModal
          workflow={historyWorkflow}
          tenantId={selectedTenantId}
          onClose={() => setHistoryWorkflow(null)}
        />
      )}
      {rcaWorkflow && (
        <RcaReportModal
          record={rcaWorkflow}
          onClose={() => setRcaWorkflow(null)}
        />
      )}
      <div className="section-header">
        <div className="section-header-left">
          <h2 className="section-title">Recent Failed / Timed Out Workflows</h2>
          {selectedTenant && !selectedTenant.cadence_web_url && (
            <p className="section-subtitle failures-history-hint">
              Set Cadence Web URL in client settings to inspect workflow history on click
            </p>
          )}
        </div>
        <div className="section-header-right">
          {notificationsEnabled && (
            <FailuresAlertBell
              active={activeAlerts && activeAlerts.has("recent-failures")}
              onClick={() =>
                onAlertSetup({
                  tileId: "recent-failures",
                  tileLabel: "Recent Failed/Timed Out Workflows",
                })
              }
              title={
                activeAlerts && activeAlerts.has("recent-failures")
                  ? "Alert active — click to manage"
                  : "Set up alert"
              }
            />
          )}
          {failures && failures.length > 0 && (
            <span className="failure-count">
              {filteredFailures.length} of {failures.length}
            </span>
          )}
          <label className="limit-selector">
            Show
            <select
              value={limit}
              onChange={(e) => onLimitChange(Number(e.target.value))}
            >
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
              <option value={500}>500</option>
            </select>
          </label>
          {totalFailed > 0 && (
            <div className="pagination-controls">
              <button
                className="pagination-btn"
                disabled={!hasPrevPage}
                onClick={() => onOffsetChange(Math.max(0, offset - pageSize))}
              >
                ← Prev
              </button>
              <span className="pagination-info">
                {totalPages > 0 ? `${currentPage} / ${totalPages}` : "0 / 0"}
              </span>
              <button
                className="pagination-btn"
                disabled={!hasNextPage}
                onClick={() => onOffsetChange(offset + pageSize)}
              >
                Next →
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="failures-filters">
        <div className="filter-group">
          <span className="filter-label">Status</span>
          <div className="filter-chips">
            {STATUS_OPTIONS.map((status) => (
              <button
                key={status}
                className={`filter-chip${statusFilter.includes(status) ? " active" : ""}`}
                onClick={() => toggleStatus(status)}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-group">
          <span className="filter-label">Tasklist</span>
          <TasklistDropdown
            availableTasklists={availableTasklists}
            tasklistFilter={tasklistFilter}
            onTasklistFilterChange={onTasklistFilterChange}
          />
        </div>

        <div className="filter-group">
          <span className="filter-label">RCA</span>
          <button
            className={`filter-chip${impactOnly ? " active" : ""}`}
            onClick={() => setImpactOnly((current) => !current)}
          >
            Customer impact only
          </button>
        </div>

        <div className="filter-group">
          <span className="filter-label">View</span>
          <ColumnVisibilityPicker
            options={availableColumnOptions}
            visibleKeys={visibleColumns}
            onToggle={toggleColumn}
            onReset={resetColumns}
          />
        </div>

        {codefacPipelines && codefacPipelines.length > 0 && (
          <div className="filter-group">
            <span className="filter-label">Pipeline</span>
            <select
              className="pipeline-filter-select"
              value={selectedPipelineId}
              onChange={(e) => setSelectedPipelineId(e.target.value)}
            >
              {codefacPipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {!failures || failures.length === 0 ? (
        <div className="failures-empty">
          <span className="empty-icon">✓</span>
          <p>No recent failures</p>
        </div>
      ) : filteredFailures.length === 0 ? (
        <div className="table-container">
          <table className="failures-table">
            <thead>
              <tr>
                {showColumn("triggerAction") && <th style={{ width: "36px" }}></th>}
                {showColumn("workflowRun") && (
                  <th className="col-workflow-run">Workflow / Run</th>
                )}
                {showColumn("failureReason") && (
                  <th className="col-failure-reason">Failure Reason</th>
                )}
                {showColumn("workflowType") && (
                  <th className="col-workflow-type">Type</th>
                )}
                {showColumn("customerImpact") && (
                  <th className="col-customer-impact">Customer Impact</th>
                )}
                {showColumn("tasklist") && <th className="col-tasklist">Tasklist</th>}
                {showColumn("status") && <th className="col-status">Status</th>}
                {showColumn("closeTime") && (
                  <th className="col-close-time">Close Time</th>
                )}
                {showColumn("triggered") && <th style={{ width: "60px" }}>Triggered</th>}
                {showColumn("lastPipeline") && (
                  <th style={{ width: "110px" }}>Last Pipeline</th>
                )}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={emptyColSpan} className="no-matches-cell">
                  No workflows match the selected filters.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <div className="table-container">
          <table className="failures-table">
            <thead>
              <tr>
                {showColumn("triggerAction") && <th style={{ width: "36px" }}></th>}
                {showColumn("workflowRun") && (
                  <th className="col-workflow-run">Workflow / Run</th>
                )}
                {showColumn("failureReason") && (
                  <th className="col-failure-reason">Failure Reason</th>
                )}
                {showColumn("workflowType") && (
                  <th className="col-workflow-type">Type</th>
                )}
                {showColumn("customerImpact") && (
                  <th className="col-customer-impact">Customer Impact</th>
                )}
                {showColumn("tasklist") && <th className="col-tasklist">Tasklist</th>}
                {showColumn("status") && <th className="col-status">Status</th>}
                {showColumn("closeTime") && (
                  <th className="col-close-time">Close Time</th>
                )}
                {showColumn("triggered") && <th style={{ width: "60px" }}>Triggered</th>}
                {showColumn("lastPipeline") && (
                  <th style={{ width: "110px" }}>Last Pipeline</th>
                )}
              </tr>
            </thead>
            <tbody>
              {filteredFailures.map((f, idx) => {
                const triggerEntry =
                  triggeredMap[recentFailureKey(f.workflow_id, f.run_id)];
                const triggerMeta = pipelineStatusMeta(triggerEntry?.status);
                return (
                  <tr
                    key={idx}
                    className={canViewHistory ? "failures-row-clickable" : ""}
                    onClick={(e) => handleRowClick(f, e)}
                  >
                    {showColumn("triggerAction") && (
                      <td style={{ textAlign: "center", padding: "6px" }}>
                        <button
                          className="pipeline-trigger-btn"
                          title={
                            selectedPipelineId
                              ? "Trigger pipeline"
                              : "Select a pipeline first"
                          }
                          disabled={
                            !selectedPipelineId ||
                            triggering[f.workflow_id || f.run_id]
                          }
                          onClick={() => handleTrigger(f)}
                        >
                          {triggering[f.workflow_id || f.run_id] ? (
                            <span className="pipeline-spinner" />
                          ) : (
                            <svg
                              width="11"
                              height="11"
                              viewBox="0 0 14 14"
                              fill="none"
                              aria-hidden="true"
                            >
                              <path
                                d="M3 1.5V12.5L12 7L3 1.5Z"
                                fill="currentColor"
                              />
                            </svg>
                          )}
                        </button>
                      </td>
                    )}
                    {showColumn("workflowRun") && (
                      <td className="cell-id">
                        <div className="cell-id-stack">
                          <div className="cell-id-line">
                            <span className="cell-id-label">Workflow</span>
                            <code title={f.workflow_id}>{f.workflow_id}</code>
                          </div>
                          <div className="cell-id-line">
                            <span className="cell-id-label">Run</span>
                            <code title={f.run_id}>{f.run_id}</code>
                          </div>
                        </div>
                      </td>
                    )}
                    {showColumn("failureReason") && (
                      <td className="cell-reason" title={f.failure_reason || ""}>
                        {f.failure_reason ? (
                          <code>{f.failure_reason}</code>
                        ) : (
                          <span className="cell-reason-empty">—</span>
                        )}
                      </td>
                    )}
                    {showColumn("workflowType") && (
                      <td className="cell-type">
                        {f.workflow_type}
                      </td>
                    )}
                    {showColumn("customerImpact") && (
                      <td className="cell-impact">
                        {f.has_rca ? (
                          <div className="cell-impact-stack">
                            <span
                              className={`cell-impact-pill${f.has_customer_impact ? " has-impact" : ""}`}
                            >
                              {f.has_customer_impact
                                ? "Customer impact"
                                : "No impact noted"}
                            </span>
                            <p className="cell-impact-preview">
                              {f.customer_impact_details ||
                                f.customer_impact_summary ||
                                f.rca_summary ||
                                "Open the RCA report for details."}
                            </p>
                            <div className="cell-impact-actions">
                              <button
                                type="button"
                                className="cell-impact-action"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setRcaWorkflow(f);
                                }}
                              >
                                View RCA
                              </button>
                              {f.open_mr_url && (
                                <a
                                  className="cell-impact-action"
                                  href={f.open_mr_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  {f.open_mr_label &&
                                  f.open_mr_label !== f.open_mr_url
                                    ? f.open_mr_label
                                    : "Open MR/PR"}
                                </a>
                              )}
                            </div>
                          </div>
                        ) : (
                          <span className="cell-reason-empty">No RCA yet</span>
                        )}
                      </td>
                    )}
                    {showColumn("tasklist") && (
                      <td className="cell-tasklist" title={f.tasklist}>
                        <code>{f.tasklist}</code>
                      </td>
                    )}
                    {showColumn("status") && (
                      <td>
                        <span
                          className={`status-badge ${getStatusClass(f.status)}`}
                        >
                          {f.status}
                        </span>
                      </td>
                    )}
                    {showColumn("closeTime") && (
                      <td className="cell-time">{f.close_time}</td>
                    )}
                    {showColumn("triggered") && (
                      <td style={{ textAlign: "center" }}>
                        {triggerMeta ? (
                          <span
                            title={triggerMeta.title}
                            style={{
                              color: triggerMeta.color,
                              fontSize: 14,
                              fontWeight: 600,
                            }}
                          >
                            {triggerMeta.icon}
                          </span>
                        ) : (
                          <span
                            style={{
                              color: "var(--fg-tertiary)",
                              fontSize: 11,
                            }}
                          >
                            —
                          </span>
                        )}
                      </td>
                    )}
                    {showColumn("lastPipeline") && (
                      <td
                        style={{
                          fontSize: 11,
                          color: "var(--fg-secondary)",
                        }}
                      >
                        {triggerEntry ? (
                          <>
                            <span
                              style={{
                                fontWeight: 500,
                                color: "var(--fg)",
                              }}
                            >
                              {triggerEntry.pipeline || ""}
                            </span>
                            <span
                              style={{
                                display: "block",
                                fontSize: 10,
                                color: "var(--fg-tertiary)",
                              }}
                            >
                              {triggerEntry.time || ""}
                            </span>
                            <span
                              style={{
                                display: "block",
                                fontSize: 10,
                                color: "var(--fg-tertiary)",
                                textTransform: "capitalize",
                              }}
                            >
                              {triggerEntry.source}
                            </span>
                          </>
                        ) : (
                          "—"
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
    </div>
  );
}

export default RecentFailures;
