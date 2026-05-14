import "./ActivityErrors.css";

const ACTIVITY_STATUS_OPTIONS = [
  "Open",
  "Completed",
  "Failed",
  "Timeout",
  "Continued as New",
  "Closed",
];

function ActivityErrors({
  activityErrors,
  statusFilter,
  onStatusFilterChange,
  errorDetailField,
  onErrorDetailFieldChange,
}) {
  // Normalize filter values for comparison (lowercase, no spaces)
  const normalizeStatus = (s) =>
    s.toLowerCase().replace(/\s+/g, "").replace(/_/g, "");

  const hasData = activityErrors && activityErrors.length > 0;
  // Show Error column only when we have error data from backend
  const hasErrorColumn = hasData && activityErrors.some((e) => e.error);

  // Toggle a status in the filter
  const toggleStatus = (status) => {
    const normalized = normalizeStatus(status);
    const currentNormalized = statusFilter.map(normalizeStatus);
    const newFilter = currentNormalized.includes(normalized)
      ? statusFilter.filter((s) => normalizeStatus(s) !== normalized)
      : [...statusFilter, status];
    onStatusFilterChange(newFilter);
  };

  return (
    <div className="activity-errors-section">
      <div className="section-header">
        <h2 className="section-title">Activity Errors</h2>
        <div className="section-header-right">
          {hasData && (
            <span className="error-count">
              {activityErrors.length} error types
            </span>
          )}
        </div>
      </div>

      {/* Status Filter */}
      <div className="activity-errors-filters">
        <div className="filter-group">
          <span className="filter-label">Status:</span>
          <div className="filter-chips">
            {ACTIVITY_STATUS_OPTIONS.map((status) => {
              const isActive =
                statusFilter.length === 0 ||
                statusFilter.some(
                  (s) => normalizeStatus(s) === normalizeStatus(status),
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
                      // If show all, switch to only this status
                      onStatusFilterChange([status]);
                    } else if (isOnly) {
                      // If this is the only active filter, toggle to show all
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

      {/* Error Detail Field Config */}
      <div
        className="activity-errors-filters"
        style={{ borderTop: "1px solid #e0e0e0", borderBottom: "none" }}
      >
        <div className="filter-group">
          <span className="filter-label">Error Field:</span>
          <input
            type="text"
            className="error-field-input"
            value={errorDetailField}
            onChange={(e) => onErrorDetailFieldChange(e.target.value)}
            placeholder="ES field name for errors (e.g. Attr.Reason)"
            title="Elasticsearch field name containing the actual error message"
          />
          {errorDetailField && (
            <button
              className="filter-chip chip-clear"
              onClick={() => onErrorDetailFieldChange("")}
              title="Clear error field"
              style={{ fontSize: "0.72rem", padding: "3px 10px" }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="activity-errors-body">
        {hasData ? (
          <table className="activity-errors-table">
            <thead>
              <tr>
                <th className="col-workflow-type">Workflow Type</th>
                {hasErrorColumn && <th className="col-error">Error</th>}
                <th className="col-count">Count</th>
              </tr>
            </thead>
            <tbody>
              {activityErrors.map((err, idx) => (
                <tr key={idx}>
                  <td className="workflow-type-cell">
                    <code className="workflow-type-code">
                      {err.workflow_type}
                    </code>
                  </td>
                  {hasErrorColumn && (
                    <td className="error-cell">
                      <code className="error-detail-code">
                        {err.error || "-"}
                      </code>
                    </td>
                  )}
                  <td className="error-count-cell">
                    <span className="count-badge">
                      {err.count.toLocaleString()}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="empty-state">
            <span className="empty-icon">&#128269;</span>
            <p>No activity errors match the selected filter.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default ActivityErrors;
