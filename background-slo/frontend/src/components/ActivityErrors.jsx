import { useState } from "react";
import "./ActivityErrors.css";

const ACTIVITY_STATUS_OPTIONS = [
  "Open",
  "Completed",
  "Failed",
  "Timeout",
  "Continued as New",
  "Closed",
];

function normalizeStatus(status) {
  return status.toLowerCase().replace(/\s+/g, "").replace(/_/g, "");
}

function getStatusClass(status) {
  const normalized = normalizeStatus(status);
  if (normalized === "failed") return "status-failed";
  if (normalized === "timedout" || normalized === "timeout")
    return "status-timedout";
  if (normalized === "terminated") return "status-terminated";
  if (normalized === "cancelled" || normalized === "canceled")
    return "status-cancelled";
  return "status-default";
}

function isFailureBreakdownFilter(statusFilter) {
  if (!Array.isArray(statusFilter) || statusFilter.length === 0) return false;
  return statusFilter.every((status) => {
    const normalized = normalizeStatus(status);
    return normalized === "failed" || normalized === "timedout" || normalized === "timeout";
  });
}

function ActivityErrors({
  activityErrors,
  liveFailureCount,
  processedFailureCount,
  pendingFailureCount,
  hasPendingFailures,
  statusFilter,
  onStatusFilterChange,
}) {
  const [expandedWorkflowTypes, setExpandedWorkflowTypes] = useState({});
  const hasRows = Array.isArray(activityErrors) && activityErrors.length > 0;
  const showFailureBreakdown = isFailureBreakdownFilter(statusFilter);

  const groupedErrors = [];
  const groupedMap = new Map();

  (activityErrors || []).forEach((entry) => {
    const workflowType = entry.workflow_type || "Unknown workflow";
    const existing = groupedMap.get(workflowType);
    if (existing) {
      existing.totalCount += entry.count || 0;
      existing.errorTypes.push(entry);
      if (entry.status && !existing.statuses.includes(entry.status)) {
        existing.statuses.push(entry.status);
      }
      return;
    }

    const next = {
      workflowType,
      totalCount: entry.count || 0,
      errorTypes: [entry],
      statuses: entry.status ? [entry.status] : [],
    };
    groupedMap.set(workflowType, next);
    groupedErrors.push(next);
  });

  groupedErrors.sort((a, b) => b.totalCount - a.totalCount);
  groupedErrors.forEach((group) => {
    group.errorTypes.sort((a, b) => {
      if ((b.count || 0) !== (a.count || 0)) return (b.count || 0) - (a.count || 0);
      return (a.error || "").localeCompare(b.error || "");
    });
  });

  const toggleStatus = (status) => {
    const normalized = normalizeStatus(status);
    const currentNormalized = statusFilter.map(normalizeStatus);
    const newFilter = currentNormalized.includes(normalized)
      ? statusFilter.filter((item) => normalizeStatus(item) !== normalized)
      : [...statusFilter, status];
    onStatusFilterChange(newFilter);
  };

  const toggleWorkflowType = (workflowType) => {
    setExpandedWorkflowTypes((prev) => ({
      ...prev,
      [workflowType]: !prev[workflowType],
    }));
  };

  return (
    <div className="activity-errors-section">
      <div className="section-header">
        <h2 className="section-title">Activity Errors</h2>
        <div className="section-header-right">
          {hasRows && (
            <span className="error-count">
              {showFailureBreakdown
                ? `${groupedErrors.length} workflow types / ${activityErrors.length} error groups`
                : `${activityErrors.length} workflow types`}
            </span>
          )}
          {showFailureBreakdown && (
            <span className="activity-live-count">
              Live ES matches: {(liveFailureCount || 0).toLocaleString()}
            </span>
          )}
        </div>
      </div>

      <div className="activity-errors-filters">
        <div className="filter-group">
          <span className="filter-label">Status:</span>
          <div className="filter-chips">
            {ACTIVITY_STATUS_OPTIONS.map((status) => {
              const isActive =
                statusFilter.length === 0 ||
                statusFilter.some(
                  (item) => normalizeStatus(item) === normalizeStatus(status),
                );
              const isOnly =
                statusFilter.length === 1 &&
                normalizeStatus(statusFilter[0]) === normalizeStatus(status);
              return (
                <button
                  key={status}
                  className={`filter-chip ${isActive && statusFilter.length > 0 ? "active" : ""} ${statusFilter.length === 0 ? "active" : ""}`}
                  onClick={() => {
                    if (statusFilter.length === 0) {
                      onStatusFilterChange([status]);
                    } else if (isOnly) {
                      onStatusFilterChange([]);
                    } else {
                      toggleStatus(status);
                    }
                  }}
                  title={`Filter by ${status}`}
                >
                  {status}
                </button>
              );
            })}
            {statusFilter.length > 0 && (
              <button
                className="filter-chip chip-clear"
                onClick={() => onStatusFilterChange([])}
                title="Show all statuses"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {showFailureBreakdown && (
        <div className="activity-errors-note">
          <p>
            Click a workflow type to inspect the stored Cadence
            reasons/messages behind its count. Detailed grouping is only shown
            for Failed and TimedOut workflows that have already been enriched.
          </p>
        </div>
      )}

      <div className="activity-errors-body">
        {hasRows ? (
          showFailureBreakdown ? (
            <table className="activity-errors-table">
              <thead>
                <tr>
                  <th className="col-workflow-type">Workflow Type</th>
                  <th className="col-error">Error Type</th>
                  <th className="col-status">Status</th>
                  <th className="col-count">Count</th>
                </tr>
              </thead>
              <tbody>
                {groupedErrors.map((group) => {
                  const isExpanded = Boolean(
                    expandedWorkflowTypes[group.workflowType],
                  );
                  return (
                    <FragmentGroup
                      key={group.workflowType}
                      group={group}
                      isExpanded={isExpanded}
                      onToggle={() => toggleWorkflowType(group.workflowType)}
                    />
                  );
                })}
              </tbody>
            </table>
          ) : (
            <table className="activity-errors-table">
              <thead>
                <tr>
                  <th className="col-workflow-type">Workflow Type</th>
                  <th className="col-count">Count</th>
                </tr>
              </thead>
              <tbody>
                {(activityErrors || []).map((entry, index) => (
                  <tr key={`${entry.workflow_type || entry.workflowType}-${index}`}>
                    <td className="workflow-type-cell">
                      <code className="workflow-type-code">
                        {entry.workflow_type || entry.workflowType || "Unknown workflow"}
                      </code>
                    </td>
                    <td className="error-count-cell">
                      <span className="count-badge">
                        {(entry.count || 0).toLocaleString()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : (
          <div className="empty-state">
            <span className="empty-icon">&#128269;</span>
            <p>
              {showFailureBreakdown
                ? "No stored workflow failures match the selected filter."
                : "No activity errors match the selected filter."}
            </p>
          </div>
        )}
        {showFailureBreakdown && hasPendingFailures && (
          <div className="activity-errors-pending">
            <span className="activity-errors-pending-badge">
              Latest failure errors exist and will be added...
            </span>
            <span className="activity-errors-pending-meta">
              Showing {(processedFailureCount || 0).toLocaleString()} categorized
              failures from DB out of {(liveFailureCount || 0).toLocaleString()}{" "}
              live ES matches
              {pendingFailureCount > 0
                ? ` (${pendingFailureCount.toLocaleString()} pending)`
                : ""}
              .
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function FragmentGroup({ group, isExpanded, onToggle }) {
  return (
    <>
      <tr
        className="activity-errors-group-row"
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
      >
        <td className="workflow-type-cell">
          <div className="workflow-group-toggle">
            <span className={`workflow-group-chevron${isExpanded ? " open" : ""}`}>
              &#8250;
            </span>
            <code className="workflow-type-code">{group.workflowType}</code>
          </div>
        </td>
        <td className="group-summary-cell">
          {group.errorTypes.length} error types
        </td>
        <td className="group-status-cell">
          {group.statuses.length > 0 ? group.statuses.join(", ") : "All"}
        </td>
        <td className="error-count-cell">
          <span className="count-badge">
            {group.totalCount.toLocaleString()}
          </span>
        </td>
      </tr>
      {isExpanded &&
        group.errorTypes.map((entry, index) => {
          const secondaryText = [
            entry.message,
            entry.details,
            entry.fetch_error,
            entry.reason,
          ].find((value) => value && value !== entry.error);
          return (
            <tr
              key={`${group.workflowType}-${entry.error}-${entry.status}-${index}`}
              className="activity-errors-detail-row"
            >
              <td className="workflow-detail-cell">
                <span className="workflow-detail-indent">↳</span>
              </td>
              <td className="error-cell">
                <code className="error-detail-code">{entry.error || "-"}</code>
                {secondaryText && (
                  <div className="error-secondary-text">{secondaryText}</div>
                )}
              </td>
              <td className="status-cell">
                <span className={`status-badge ${getStatusClass(entry.status)}`}>
                  {entry.status || "Unknown"}
                </span>
              </td>
              <td className="error-count-cell">
                <span className="count-badge">
                  {(entry.count || 0).toLocaleString()}
                </span>
              </td>
            </tr>
          );
        })}
    </>
  );
}

export default ActivityErrors;
