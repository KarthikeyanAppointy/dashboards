import { useState, useRef, useEffect } from "react";
import "./RecentFailures.css";

const STATUS_OPTIONS = ["Failed", "TimedOut"];

function getStatusClass(status) {
  if (status === "Failed" || status === "failed") return "status-failed";
  if (status === "TimedOut" || status === "timed_out" || status === "Timed Out")
    return "status-timedout";
  return "status-default";
}

function TasklistDropdown({ availableTasklists, tasklistFilter, onTasklistFilterChange }) {
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
    tl.toLowerCase().includes(search.toLowerCase())
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
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <rect x="1" y="2" width="10" height="1.5" rx="0.75" fill="currentColor"/>
          <rect x="1" y="5.25" width="7" height="1.5" rx="0.75" fill="currentColor"/>
          <rect x="1" y="8.5" width="5" height="1.5" rx="0.75" fill="currentColor"/>
        </svg>
        <span className="tl-dropdown-label">{label}</span>
        {selectedCount > 0 && (
          <span className="tl-dropdown-count">{selectedCount}</span>
        )}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true" className={`tl-dropdown-chevron${open ? " open" : ""}`}>
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div className="tl-dropdown-panel" role="listbox" aria-multiselectable="true">
          {availableTasklists.length > 6 && (
            <div className="tl-dropdown-search">
              <input
                type="text"
                placeholder="Filter tasklists…"
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
                  <label key={tl} className={`tl-dropdown-item${checked ? " checked" : ""}`}>
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
                onClick={() => { onTasklistFilterChange([]); setOpen(false); }}
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
}) {
  const pageSize = limit || 20;
  const currentPage = Math.floor(offset / pageSize) + 1;
  const totalPages = Math.ceil(totalFailed / pageSize);
  const hasPrevPage = offset > 0;
  const hasNextPage = offset + pageSize < totalFailed;

  const filteredFailures = (failures || []).filter((f) => {
    const statusMatch =
      statusFilter.length === 0 ||
      statusFilter.length === 2 ||
      statusFilter.includes(f.status);
    const tasklistMatch =
      tasklistFilter.length === 0 || tasklistFilter.includes(f.tasklist);
    return statusMatch && tasklistMatch;
  });

  const toggleStatus = (status) => {
    const newFilter = statusFilter.includes(status)
      ? statusFilter.filter((s) => s !== status)
      : [...statusFilter, status];
    onStatusFilterChange(newFilter);
  };

  return (
    <div className="failures-section">
      <div className="section-header">
        <h2 className="section-title">Recent Failed / Timed Out Workflows</h2>
        <div className="section-header-right">
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
                <th>Workflow ID</th><th>Type</th><th>Tasklist</th>
                <th>Status</th><th>Close Time</th>
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
                <th>Workflow ID</th><th>Type</th><th>Tasklist</th>
                <th>Status</th><th>Close Time</th>
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
                    <span className={`status-badge ${getStatusClass(f.status)}`}>
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
