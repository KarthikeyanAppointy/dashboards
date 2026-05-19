import "./TasklistLatency.css";

const WINDOW_OPTIONS = [
  { label: "Last 1h", value: 3600 },
  { label: "Last 3h", value: 10800 },
  { label: "Last 6h", value: 21600 },
  { label: "Last 12h", value: 43200 },
  { label: "Last 1d", value: 86400 },
];

const LatencyAlertBell = ({ active, onClick, title }) => (
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
      width="11"
      height="11"
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

function formatLatency(ms) {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }
  return `${Math.round(ms)}ms`;
}

function getBarWidth(avgMs, maxMs) {
  if (maxMs <= 0) return 0;
  const pct = (avgMs / maxMs) * 100;
  return Math.max(pct, 4);
}

function getBarClass(avgMs, maxMs) {
  if (maxMs <= 0) return "bar-low";
  const ratio = avgMs / maxMs;
  if (ratio > 0.66) return "bar-high";
  if (ratio > 0.33) return "bar-medium";
  return "bar-low";
}

function TasklistLatency({
  tasklists,
  tasklistWindow,
  activeAlerts,
  onAlertSetup,
}) {
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
              <th className="th-alert">Alert</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((tl, idx) => {
              const encodedName = encodeURIComponent(tl.tasklist);
              const tileId = `tasklist-latency:${encodedName}`;
              const tileLabel = `Tasklist: ${tl.tasklist}`;
              const isActive = activeAlerts && activeAlerts.has(tileId);
              return (
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
                  <td className="cell-alert">
                    <LatencyAlertBell
                      active={isActive}
                      onClick={() => onAlertSetup({ tileId, tileLabel })}
                      title={
                        isActive
                          ? "Alert active — click to manage"
                          : "Set up alert"
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default TasklistLatency;
