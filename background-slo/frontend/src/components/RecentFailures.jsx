import { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "../auth/AuthContext";
import WorkflowHistoryModal from "./WorkflowHistoryModal";
import "./RecentFailures.css";

const STATUS_OPTIONS = ["Failed", "TimedOut"];

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
}) {
  const { authFetch } = useAuth();
  const [historyWorkflow, setHistoryWorkflow] = useState(null);
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

  const filteredFailures = (failures || []).filter((f) => {
    const statusMatch =
      statusFilter.length === 0 ||
      statusFilter.length === 2 ||
      statusFilter.includes(f.status);
    const tasklistMatch =
      tasklistFilter.length === 0 || tasklistFilter.includes(f.tasklist);
    return statusMatch && tasklistMatch;
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

  // Fetch pipeline trigger history to populate Triggered/Last Pipeline columns
  useEffect(() => {
    if (!selectedTenantId) return;
    let cancelled = false;
    const fetchHistory = async () => {
      try {
        const res = await authFetch(
          `/api/alerts/history?tenant_id=${selectedTenantId}&limit=200`,
        );
        if (!res.ok) return;
        const json = await res.json();
        const entries = Array.isArray(json)
          ? json
          : (json.results ?? json.history ?? []);
        if (cancelled) return;
        // Build map of workflow_id -> { triggered, pipeline, time }
        const newMap = {};
        for (const entry of entries) {
          if (entry.channel === "pipeline" && entry.workflow_id) {
            const ts = entry.sent_at
              ? new Date(entry.sent_at).toLocaleTimeString()
              : "";
            newMap[entry.workflow_id] = {
              triggered: true,
              pipeline: entry.recipient || "",
              time: ts,
            };
          }
        }
        setTriggeredMap((prev) => ({ ...prev, ...newMap }));
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
    setTriggering((prev) => ({ ...prev, [wfKey]: true }));
    try {
      const pipeline = codefacPipelines.find(
        (p) => String(p.id) === selectedPipelineId,
      );
      await onTriggerPipeline(Number(selectedPipelineId), workflow);
      const now = new Date().toLocaleTimeString();
      setTriggeredMap((prev) => ({
        ...prev,
        [wfKey]: {
          triggered: true,
          pipeline: pipeline ? pipeline.name : "",
          time: now,
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
                {codefacPipelines &&
                  codefacPipelines.length > 0 &&
                  notificationsEnabled && <th style={{ width: "36px" }}></th>}
                <th>Workflow ID</th>
                <th>Run ID</th>
                <th>Type</th>
                <th>Tasklist</th>
                <th style={{ width: "72px" }}>Status</th>
                <th style={{ width: "100px" }}>Close Time</th>
                {codefacPipelines &&
                  codefacPipelines.length > 0 &&
                  notificationsEnabled && (
                    <>
                      <th style={{ width: "60px" }}>Triggered</th>
                      <th style={{ width: "110px" }}>Last Pipeline</th>
                    </>
                  )}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={9} className="no-matches-cell">
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
                {codefacPipelines &&
                  codefacPipelines.length > 0 &&
                  notificationsEnabled && <th style={{ width: "36px" }}></th>}
                <th>Workflow ID</th>
                <th>Run ID</th>
                <th>Type</th>
                <th>Tasklist</th>
                <th style={{ width: "72px" }}>Status</th>
                <th style={{ width: "100px" }}>Close Time</th>
                {codefacPipelines &&
                  codefacPipelines.length > 0 &&
                  notificationsEnabled && (
                    <>
                      <th style={{ width: "60px" }}>Triggered</th>
                      <th style={{ width: "110px" }}>Last Pipeline</th>
                    </>
                  )}
              </tr>
            </thead>
            <tbody>
              {filteredFailures.map((f, idx) => (
                <tr
                  key={idx}
                  className={canViewHistory ? "failures-row-clickable" : ""}
                  onClick={(e) => handleRowClick(f, e)}
                  title={
                    canViewHistory
                      ? "Click to view workflow history"
                      : undefined
                  }
                >
                  {codefacPipelines &&
                    codefacPipelines.length > 0 &&
                    notificationsEnabled && (
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
                  <td className="cell-id">
                    <code title={f.workflow_id}>{f.workflow_id}</code>
                  </td>
                  <td className="cell-run-id">
                    <code title={f.run_id}>{f.run_id}</code>
                  </td>
                  <td className="cell-type" title={f.workflow_type}>
                    {f.workflow_type}
                  </td>
                  <td className="cell-tasklist" title={f.tasklist}>
                    <code>{f.tasklist}</code>
                  </td>
                  <td>
                    <span
                      className={`status-badge ${getStatusClass(f.status)}`}
                    >
                      {f.status}
                    </span>
                  </td>
                  <td className="cell-time">{f.close_time}</td>
                  {codefacPipelines &&
                    codefacPipelines.length > 0 &&
                    notificationsEnabled && (
                      <>
                        <td style={{ textAlign: "center" }}>
                          {triggeredMap[f.workflow_id || f.run_id]
                            ?.triggered ? (
                            <span
                              style={{
                                color: "var(--success)",
                                fontSize: 14,
                                fontWeight: 600,
                              }}
                            >
                              ✓
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
                        <td
                          style={{
                            fontSize: 11,
                            color: "var(--fg-secondary)",
                          }}
                        >
                          {triggeredMap[f.workflow_id || f.run_id]
                            ?.triggered ? (
                            <>
                              <span
                                style={{
                                  fontWeight: 500,
                                  color: "var(--fg)",
                                }}
                              >
                                {triggeredMap[f.workflow_id || f.run_id]
                                  ?.pipeline || ""}
                              </span>
                              <span
                                style={{
                                  display: "block",
                                  fontSize: 10,
                                  color: "var(--fg-tertiary)",
                                }}
                              >
                                {triggeredMap[f.workflow_id || f.run_id]
                                  ?.time || ""}
                              </span>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                      </>
                    )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default RecentFailures;
