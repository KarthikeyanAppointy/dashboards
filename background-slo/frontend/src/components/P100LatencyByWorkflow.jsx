import { useState } from "react";
import "./P100LatencyByWorkflow.css";

function formatLatency(ms) {
  if (!ms || ms === 0) return "-";
  if (ms < 1000) return `${ms.toLocaleString()} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

const SortIcon = ({ field, sortKey, sortDir }) => {
  const active = sortKey === field;
  return (
    <span className={`sort-icon${active ? " sort-active" : ""}`} aria-hidden="true">
      <svg width="10" height="12" viewBox="0 0 10 12" fill="none">
        <path
          d="M5 1L5 11M5 1L2 4M5 1L8 4"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={active && sortDir === "asc" ? 1 : 0.25}
        />
        <path
          d="M5 11L2 8M5 11L8 8"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={active && sortDir === "desc" ? 1 : 0.25}
        />
      </svg>
    </span>
  );
};

function P100LatencyByWorkflow({ data }) {
  const [sortKey, setSortKey] = useState("p100_latency_ms");
  const [sortDir, setSortDir] = useState("desc");

  if (!data || data.length === 0) return null;

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sorted = [...data].sort((a, b) => {
    const aVal = a[sortKey] ?? 0;
    const bVal = b[sortKey] ?? 0;
    return sortDir === "desc" ? bVal - aVal : aVal - bVal;
  });

  return (
    <div className="p100-by-workflow-section">
      <div className="section-header">
        <h2 className="section-title">P100 Latency by Workflow Type</h2>
        <span className="p100-count">{data.length} workflow types</span>
      </div>
      <div className="p100-table-container">
        <table className="p100-table">
          <thead>
            <tr>
              <th className="col-p100-workflow-type">Workflow Type</th>
              <th
                className={`col-p100-count sortable${sortKey === "count" ? " sort-active" : ""}`}
                onClick={() => handleSort("count")}
              >
                Count <SortIcon field="count" sortKey={sortKey} sortDir={sortDir} />
              </th>
              <th
                className={`col-p100-latency sortable${sortKey === "p100_latency_ms" ? " sort-active" : ""}`}
                onClick={() => handleSort("p100_latency_ms")}
              >
                P100 Latency <SortIcon field="p100_latency_ms" sortKey={sortKey} sortDir={sortDir} />
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((entry, idx) => (
              <tr key={idx}>
                <td className="p100-workflow-type-cell">
                  <code className="p100-workflow-type-code">
                    {entry.workflow_type}
                  </code>
                </td>
                <td className="p100-count-cell">
                  <span className="p100-count-badge">
                    {entry.count.toLocaleString()}
                  </span>
                </td>
                <td className="p100-latency-cell">
                  <span className="p100-latency-value">
                    {formatLatency(entry.p100_latency_ms)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default P100LatencyByWorkflow;
