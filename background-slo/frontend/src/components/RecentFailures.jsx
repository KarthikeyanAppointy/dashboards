import "./RecentFailures.css";

const STATUS_OPTIONS = ["Failed", "TimedOut"];

function getStatusClass(status) {
  if (status === "Failed" || status === "failed") return "status-failed";
  if (status === "TimedOut" || status === "timed_out" || status === "Timed Out")
    return "status-timedout";
  return "status-default";
}

function RecentFailures({
  failures,
  limit,
  onLimitChange,
  statusFilter,
  onStatusFilterChange,
  tasklistFilter,
  onTasklistFilterChange,
  availableTasklists,
  startTime,
  endTime,
  onStartTimeChange,
  onEndTimeChange,
  offset,
  onOffsetChange,
  totalFailed,
}) {
  // Convert Unix timestamp (seconds) to datetime-local string value
  const timestampToDatetimeLocal = (ts) => {
    if (!ts) return "";
    const d = new Date(ts * 1000);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  // Convert datetime-local string value to Unix timestamp (seconds)
  const datetimeLocalToTimestamp = (dt) => {
    if (!dt) return null;
    const d = new Date(dt);
    return Math.floor(d.getTime() / 1000);
  };

  // Pagination calculations
  const pageSize = limit || 20;
  const currentPage = Math.floor(offset / pageSize) + 1;
  const totalPages = Math.ceil(totalFailed / pageSize);
  const hasPrevPage = offset > 0;
  const hasNextPage = offset + pageSize < totalFailed;

  // Apply client-side filtering based on status and tasklist
  const filteredFailures = (failures || []).filter((f) => {
    // Status filter: if both are selected (show all), or if the status matches
    const statusMatch =
      statusFilter.length === 0 ||
      statusFilter.length === 2 ||
      statusFilter.includes(f.status);
    // Tasklist filter: if none selected (show all), or if the tasklist matches
    const tasklistMatch =
      tasklistFilter.length === 0 || tasklistFilter.includes(f.tasklist);
    return statusMatch && tasklistMatch;
  });

  // Toggle a status in the filter
  const toggleStatus = (status) => {
    const newFilter = statusFilter.includes(status)
      ? statusFilter.filter((s) => s !== status)
      : [...statusFilter, status];
    onStatusFilterChange(newFilter);
  };

  // Toggle a tasklist in the filter
  const toggleTasklist = (tasklist) => {
    const newFilter = tasklistFilter.includes(tasklist)
      ? tasklistFilter.filter((t) => t !== tasklist)
      : [...tasklistFilter, tasklist];
    onTasklistFilterChange(newFilter);
  };

  return (
    <div className="failures-section">
      <div className="section-header">
        <h2 className="section-title">Recent Failed / Timed Out Workflows</h2>
        <div className="section-header-right">
          {failures && failures.length > 0 && (
            <span className="failure-count">
              {filteredFailures.length} of {failures.length} workflows
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
          {/* Pagination Controls - Top */}
          {totalFailed > 0 && (
            <div className="pagination-controls">
              <button
                className="pagination-btn"
                disabled={!hasPrevPage}
                onClick={() => onOffsetChange(Math.max(0, offset - pageSize))}
                title="Previous page"
              >
                &larr; Prev
              </button>
              <span className="pagination-info">
                {totalPages > 0 ? `${currentPage} of ${totalPages}` : "0 of 0"}
              </span>
              <button
                className="pagination-btn"
                disabled={!hasNextPage}
                onClick={() => onOffsetChange(offset + pageSize)}
                title="Next page"
              >
                Next &rarr;
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Filter Controls — always shown so user can change filters */}
      <div className="failures-filters">
        {/* Status Filter */}
        <div className="filter-group">
          <span className="filter-label">Status:</span>
          <div className="filter-chips">
            {STATUS_OPTIONS.map((status) => (
              <button
                key={status}
                className={`filter-chip ${statusFilter.includes(status) ? "active" : ""} ${status === "Failed" ? "chip-failed" : "chip-timedout"}`}
                onClick={() => toggleStatus(status)}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {/* Tasklist Filter */}
        <div className="filter-group">
          <span className="filter-label">Tasklist:</span>
          <div className="tasklist-filter-select">
            <select
              multiple
              size={Math.min(availableTasklists.length, 5)}
              value={tasklistFilter}
              onChange={(e) => {
                const selected = Array.from(
                  e.target.options,
                  (opt) => opt.selected && opt.value,
                ).filter(Boolean);
                onTasklistFilterChange(selected);
              }}
            >
              {availableTasklists.map((tl) => (
                <option key={tl} value={tl}>
                  {tl}
                </option>
              ))}
            </select>
          </div>
          {tasklistFilter.length > 0 && (
            <div className="tasklist-selected-tags">
              {tasklistFilter.map((tl) => (
                <span key={tl} className="tasklist-tag">
                  <code>{tl}</code>
                  <button
                    className="tag-remove"
                    onClick={() => toggleTasklist(tl)}
                    title="Remove filter"
                  >
                    &times;
                  </button>
                </span>
              ))}
              <button
                className="tag-clear-all"
                onClick={() => onTasklistFilterChange([])}
                title="Clear all tasklist filters"
              >
                Clear all
              </button>
            </div>
          )}
        </div>

        {/* Date/Time Range Filter */}
        <div className="filter-group">
          <span className="filter-label">From:</span>
          <input
            type="datetime-local"
            className="date-time-input"
            value={timestampToDatetimeLocal(startTime)}
            onChange={(e) =>
              onStartTimeChange(datetimeLocalToTimestamp(e.target.value))
            }
          />
          <span className="filter-label" style={{ minWidth: "auto" }}>
            To:
          </span>
          <input
            type="datetime-local"
            className="date-time-input"
            value={timestampToDatetimeLocal(endTime)}
            onChange={(e) =>
              onEndTimeChange(datetimeLocalToTimestamp(e.target.value))
            }
          />
          {(startTime || endTime) && (
            <button
              className="filter-chip active"
              onClick={() => {
                onStartTimeChange(null);
                onEndTimeChange(null);
              }}
              title="Clear date filter"
            >
              Clear Dates
            </button>
          )}
        </div>
      </div>

      {!failures || failures.length === 0 ? (
        <div className="failures-empty">
          <span className="empty-icon">&#10003;</span>
          <p>No recent failures</p>
        </div>
      ) : filteredFailures.length === 0 ? (
        <div className="table-container">
          <table className="failures-table">
            <thead>
              <tr>
                <th>Workflow ID</th>
                <th>Type</th>
                <th>Tasklist</th>
                <th>Status</th>
                <th>Close Time</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={5} className="no-matches-cell">
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
                <th>Workflow ID</th>
                <th>Type</th>
                <th>Tasklist</th>
                <th>Status</th>
                <th>Close Time</th>
              </tr>
            </thead>
            <tbody>
              {filteredFailures.map((f, idx) => (
                <tr key={idx}>
                  <td className="cell-id">
                    <code title={f.workflow_id}>{f.workflow_id}</code>
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
