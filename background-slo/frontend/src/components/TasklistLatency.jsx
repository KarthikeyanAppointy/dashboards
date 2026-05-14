import "./TasklistLatency.css";

const WINDOW_OPTIONS = [
  { label: "Last 1h", value: 3600 },
  { label: "Last 3h", value: 10800 },
  { label: "Last 6h", value: 21600 },
  { label: "Last 12h", value: 43200 },
  { label: "Last 1d", value: 86400 },
];

function formatLatency(ms) {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }
  return `${Math.round(ms)}ms`;
}

function getBarWidth(avgMs, maxMs) {
  if (maxMs <= 0) return 0;
  const pct = (avgMs / maxMs) * 100;
  return Math.max(pct, 4); // minimum 4% so even small values are visible
}

function getBarClass(avgMs, maxMs) {
  if (maxMs <= 0) return "bar-low";
  const ratio = avgMs / maxMs;
  if (ratio > 0.66) return "bar-high";
  if (ratio > 0.33) return "bar-medium";
  return "bar-low";
}

function TasklistLatency({ tasklists, tasklistWindow }) {
  if (!tasklists || tasklists.length === 0) {
    return (
      <div className="tl-section">
        <div className="section-header">
          <h2 className="section-title">Tasklist Average Latency</h2>
          <span className="section-subtitle">Completed workflows</span>
        </div>
        <div className="tl-empty">
          <span className="empty-icon">&#10003;</span>
          <p>No tasklist latency data available</p>
        </div>
      </div>
    );
  }

  // Sort by avg latency descending (already sorted from ES, but ensure it)
  const sorted = [...tasklists].sort(
    (a, b) => b.avg_latency_ms - a.avg_latency_ms,
  );
  const maxLatency = sorted[0]?.avg_latency_ms ?? 0;

  const currentLabel =
    WINDOW_OPTIONS.find((o) => o.value === tasklistWindow)?.label ?? "Last 1h";

  return (
    <div className="tl-section">
      <div className="section-header">
        <div>
          <h2 className="section-title">Tasklist Average Latency</h2>
          <span className="section-subtitle">
            Completed workflows ({currentLabel})
          </span>
        </div>
      </div>
      <div className="table-container">
        <table className="tl-table">
          <thead>
            <tr>
              <th>Tasklist</th>
              <th>Avg Latency</th>
              <th>Workflows</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((tl, idx) => (
              <tr key={idx}>
                <td className="cell-tasklist">
                  <code>{tl.tasklist}</code>
                </td>
                <td className="cell-latency">
                  <span className="latency-value">
                    {formatLatency(tl.avg_latency_ms)}
                  </span>
                  <span
                    className={`latency-bar ${getBarClass(
                      tl.avg_latency_ms,
                      maxLatency,
                    )}`}
                    style={{
                      width: `${getBarWidth(tl.avg_latency_ms, maxLatency)}%`,
                    }}
                  ></span>
                </td>
                <td className="cell-count">
                  {tl.workflow_count.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default TasklistLatency;
