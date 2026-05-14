import "./P100LatencyByWorkflow.css";

function formatLatency(ms) {
  if (!ms || ms === 0) return "-";
  if (ms < 1000) return `${ms.toLocaleString()} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

function P100LatencyByWorkflow({ data }) {
  if (!data || data.length === 0) return null;

  return (
    <div className="p100-by-workflow-section">
      <div className="section-header">
        <h2 className="section-title">P100 Latency by Workflow Type</h2>
        <div className="section-header-right">
          <span className="p100-count">{data.length} workflow types</span>
        </div>
      </div>
      <div className="p100-table-container">
        <table className="p100-table">
          <thead>
            <tr>
              <th className="col-p100-workflow-type">Workflow Type</th>
              <th className="col-p100-count">Count</th>
              <th className="col-p100-latency">P100 Latency</th>
            </tr>
          </thead>
          <tbody>
            {data.map((entry, idx) => (
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
