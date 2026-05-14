import "./WorkflowTable.css";

function getStatusBadge(status) {
  if (status === "started") return "badge-info";
  if (status === "completed") return "badge-success";
  if (status === "failed") return "badge-danger";
  if (status === "timed_out") return "badge-warning";
  if (status === "cancelled") return "badge-secondary";
  if (status === "open") return "badge-primary";
  return "badge-default";
}

function WorkflowTable({ windows }) {
  if (!windows || windows.length === 0) return null;

  const columns = [
    { key: "started", label: "Started", badge: "started" },
    { key: "completed", label: "Completed", badge: "completed" },
    { key: "failed", label: "Failed", badge: "failed" },
    { key: "timed_out", label: "Timed Out", badge: "timed_out" },
    { key: "cancelled", label: "Cancelled", badge: "cancelled" },
    { key: "open", label: "Open", badge: "open" },
  ];

  const bestWindow = [...windows].sort(
    (left, right) => right.completed_rate - left.completed_rate,
  )[0];

  return (
    <section className="workflow-section card">
      <div className="section-header">
        <div>
          <h2 className="section-title">Workflow Rates by Time Window</h2>
          <p className="section-subtitle">
            Compare absolute counts with rate changes to see where load and
            failures are diverging.
          </p>
        </div>
        {bestWindow && (
          <div className="workflow-highlight-pill">
            Strongest completion rate: {bestWindow.label} ({bestWindow.completed_rate})
          </div>
        )}
      </div>

      <div className="table-container">
        <table className="workflow-table">
          <thead>
            <tr>
              <th>Window</th>
              <th>Started</th>
              <th>Completed</th>
              <th>Failed</th>
              <th>Timed Out</th>
              <th>Cancelled</th>
              <th>Open</th>
              <th>P100</th>
            </tr>
          </thead>
          <tbody>
            {windows.map((window) => (
              <tr key={window.label}>
                <td className="workflow-window-cell">
                  <strong>{window.label}</strong>
                  <span>{window.seconds.toLocaleString()} seconds</span>
                </td>
                {columns.map((column) => (
                  <td key={column.key}>
                    <div className="workflow-cell-stack">
                      <span className={`badge ${getStatusBadge(column.badge)}`}>
                        {(window[column.key] ?? 0).toLocaleString()}
                      </span>
                      <span className="workflow-rate-value">
                        {window[`${column.key}_rate`] ?? "-"}
                      </span>
                    </div>
                  </td>
                ))}
                <td className="workflow-p100-cell">
                  {window.p100_latency_ms
                    ? `${(window.p100_latency_ms / 1000).toFixed(1)}s`
                    : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default WorkflowTable;
