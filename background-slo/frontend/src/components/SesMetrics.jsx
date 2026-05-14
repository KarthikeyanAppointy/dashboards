import "./SesMetrics.css";

function SesMetrics({
  data,
  loading,
  error,
  periodOptions,
  periodID,
  onPeriodChange,
  onRefresh,
  regions,
  region,
  onRegionChange,
}) {
  const hasData = data && data.sends !== undefined;

  // Format a large number with commas
  const fmtNum = (n) => {
    if (n == null) return "—";
    return Number(n).toLocaleString();
  };

  // Format a percentage string (e.g. "0.1234%" -> display gracefully)
  const fmtPct = (pct) => {
    if (!pct || pct === "0.0000%") return "0%";
    // Strip trailing zeros after decimal
    return pct.replace(/\.?0+%/, "%");
  };

  // Get status class for a rate value
  const rateStatus = (pctStr) => {
    if (!pctStr) return "neutral";
    const val = parseFloat(pctStr);
    if (val <= 0.1) return "good";
    if (val <= 0.5) return "warning";
    return "bad";
  };

  // Format time range description
  const fmtRange = (data, periodOptions, periodID) => {
    const opt = periodOptions[periodID];
    if (!opt) return "";
    return opt.label;
  };

  return (
    <div className="ses-dashboard">
      {/* Controls */}
      <div className="ses-toolbar">
        <div className="ses-toolbar-group">
          <span className="ses-toolbar-label">Region</span>
          <select
            className="ses-toolbar-select"
            value={region}
            onChange={(e) => onRegionChange(e.target.value)}
          >
            {regions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div className="ses-toolbar-group">
          <span className="ses-toolbar-label">Period</span>
          <select
            className="ses-toolbar-select"
            value={periodID}
            onChange={(e) => onPeriodChange(Number(e.target.value))}
          >
            {periodOptions.map((opt, idx) => (
              <option key={idx} value={idx}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <button
          className="ses-refresh-btn"
          onClick={onRefresh}
          disabled={loading}
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
        {loading && <span className="ses-loading-spinner" />}
        {data?.timestamp && (
          <span className="ses-timestamp">
            Updated {new Date(data.timestamp).toLocaleTimeString()}
          </span>
        )}
      </div>

      {error && (
        <div className="ses-error">
          <span className="ses-error-icon">!</span>
          <span>Error: {error}</span>
        </div>
      )}

      {!hasData && !loading && !error && (
        <div className="ses-empty">
          <p>No SES data available. Check AWS credentials and configuration.</p>
        </div>
      )}

      {hasData && (
        <>
          {/* Summary Cards */}
          <div className="ses-summary">
            <div className="ses-card ses-card-sends">
              <div className="ses-card-label">Total Sends</div>
              <div className="ses-card-value">{fmtNum(data.sends)}</div>
              <div className="ses-card-sub">
                {fmtRange(data, periodOptions, periodID)}
              </div>
            </div>
            <div className="ses-card ses-card-bounces">
              <div className="ses-card-label">Bounces</div>
              <div className="ses-card-value">{fmtNum(data.bounces)}</div>
              <div className="ses-card-sub">
                {fmtNum(data.permanent_bounces)} perm /{" "}
                {fmtNum(data.transient_bounces)} trans
              </div>
            </div>
            <div className="ses-card ses-card-complaints">
              <div className="ses-card-label">Complaints</div>
              <div className="ses-card-value">{fmtNum(data.complaints)}</div>
              <div className="ses-card-sub">Feedback loop reports</div>
            </div>
            <div className="ses-card ses-card-rejects">
              <div className="ses-card-label">Rejects</div>
              <div className="ses-card-value">{fmtNum(data.rejects)}</div>
              <div className="ses-card-sub">Rejected by SES</div>
            </div>
          </div>

          {/* Rate Cards */}
          <div className="ses-rates">
            <div className="ses-card ses-card-rate">
              <div className="ses-card-label">Bounce Rate</div>
              <div
                className={`ses-card-value ses-rate-${rateStatus(data.bounce_rate)}`}
              >
                {fmtPct(data.bounce_rate)}
              </div>
              <div className="ses-card-sub">
                {fmtNum(data.bounces)} bounces / {fmtNum(data.sends)} sends
              </div>
            </div>
            <div className="ses-card ses-card-rate">
              <div className="ses-card-label">Complaint Rate</div>
              <div
                className={`ses-card-value ses-rate-${rateStatus(data.complaint_rate)}`}
              >
                {fmtPct(data.complaint_rate)}
              </div>
              <div className="ses-card-sub">
                {fmtNum(data.complaints)} complaints / {fmtNum(data.sends)}{" "}
                sends
              </div>
            </div>
            <div className="ses-card ses-card-rate">
              <div className="ses-card-label">Error Rate</div>
              <div
                className={`ses-card-value ses-rate-${rateStatus(data.error_rate)}`}
              >
                {fmtPct(data.error_rate)}
              </div>
              <div className="ses-card-sub">
                (Bounces + Complaints + Rejects) / Sends
              </div>
            </div>
          </div>

          {/* Daily Volume Table */}
          {data.daily_volume && data.daily_volume.length > 0 && (
            <div className="ses-section">
              <div className="section-header">
                <h3 className="section-title">Daily Volume</h3>
              </div>
              <div className="table-container">
                <table className="data-table ses-daily-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Sends</th>
                      <th>Bounces</th>
                      <th>Bounce %</th>
                      <th>Complaints</th>
                      <th>Complaint %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.daily_volume.map((day) => (
                      <tr key={day.date}>
                        <td>{day.date}</td>
                        <td>{fmtNum(day.sends)}</td>
                        <td>{fmtNum(day.bounces)}</td>
                        <td>
                          {day.sends > 0
                            ? ((day.bounces / day.sends) * 100).toFixed(3) + "%"
                            : "0%"}
                        </td>
                        <td>{fmtNum(day.complaints)}</td>
                        <td>
                          {day.sends > 0
                            ? ((day.complaints / day.sends) * 100).toFixed(3) +
                              "%"
                            : "0%"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default SesMetrics;
