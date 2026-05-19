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
    <span
      className={`sort-icon${active ? " sort-active" : ""}`}
      aria-hidden="true"
    >
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

function formatCount(n) {
  if (n === 0 || n === null || n === undefined) return "0";
  return n.toLocaleString();
}

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

  const maxLatency = Math.max(...data.map((d) => d.p100_latency_ms || 0));

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
                className={`col-p100-total sortable${sortKey === "count" ? " sort-active" : ""}`}
                onClick={() => handleSort("count")}
              >
                Total{" "}
                <SortIcon field="count" sortKey={sortKey} sortDir={sortDir} />
              </th>
              <th
                className={`col-p100-succeeded sortable${sortKey === "success_count" ? " sort-active" : ""}`}
                onClick={() => handleSort("success_count")}
              >
                Succeeded{" "}
                <SortIcon
                  field="success_count"
                  sortKey={sortKey}
                  sortDir={sortDir}
                />
              </th>
              <th
                className={`col-p100-failed-header sortable${sortKey === "failure_count" ? " sort-active" : ""}`}
                onClick={() => handleSort("failure_count")}
              >
                Failed{" "}
                <SortIcon
                  field="failure_count"
                  sortKey={sortKey}
                  sortDir={sortDir}
                />
              </th>
              <th
                className={`col-p100-open-header sortable${sortKey === "open_count" ? " sort-active" : ""}`}
                onClick={() => handleSort("open_count")}
              >
                Open{" "}
                <SortIcon
                  field="open_count"
                  sortKey={sortKey}
                  sortDir={sortDir}
                />
              </th>
              <th
                className={`col-p100-latency sortable${sortKey === "p100_latency_ms" ? " sort-active" : ""}`}
                onClick={() => handleSort("p100_latency_ms")}
              >
                P100 Latency{" "}
                <SortIcon
                  field="p100_latency_ms"
                  sortKey={sortKey}
                  sortDir={sortDir}
                />
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
                <td className="p100-total-cell">
                  <span className="p100-total-value">
                    {formatCount(entry.count)}
                  </span>
                </td>
                <td className="p100-succeeded-cell">
                  <span className="p100-succeeded-value">
                    {formatCount(entry.success_count)}
                  </span>
                  <span className="p100-rate-label">
                    {((entry.success_rate ?? 0) || 0).toFixed(1)}%
                  </span>
                </td>
                <td className="p100-failed-cell">
                  <span className="p100-failed-value">
                    {formatCount(entry.failure_count)}
                  </span>
                  <span className="p100-rate-label p100-rate-label-fail">
                    {((entry.failure_rate ?? 0) || 0).toFixed(1)}%
                  </span>
                </td>
                <td className="p100-open-cell">
                  <span className="p100-open-value">
                    {formatCount(entry.open_count)}
                  </span>
                </td>
                <td className="p100-latency-cell">
                  <div className="p100-latency-bar-wrap">
                    <span className="p100-latency-value">
                      {formatLatency(entry.p100_latency_ms)}
                    </span>
                    <span
                      className="p100-latency-bar"
                      style={{
                        width: `${maxLatency > 0 ? (entry.p100_latency_ms / maxLatency) * 100 : 0}%`,
                      }}
                    />
                  </div>
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
