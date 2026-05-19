import "./SesMetrics.css";

const AlertBell = ({ active, onClick, title }) => (
  <button
    className={`ses-alert-btn${active ? " active" : ""}`}
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    title={title}
    aria-label={title}
  >
    <svg
      width="12"
      height="12"
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

function SesMetrics({
  data,
  loading,
  error,
  periodOptions,
  periodID,
  onPeriodChange,
  onRefresh,
  regions,
  selectedRegions,
  onToggleRegion,
  onToggleAllRegions,
  allMetrics,
  selectedMetrics,
  onToggleMetric,
  activeAlerts,
  onAlertSetup,
  notificationsEnabled,
}) {
  const hasData = data && data.sends !== undefined;

  const fmtNum = (n) => {
    if (n == null) return "\u2014";
    return Number(n).toLocaleString();
  };

  const fmtPct = (pct) => {
    if (!pct || pct === "0.0000%") return "0%";
    return pct.replace(/\.?0+%/, "%");
  };

  const rateStatus = (pctStr) => {
    if (!pctStr) return "neutral";
    const val = parseFloat(pctStr);
    if (val <= 0.1) return "good";
    if (val <= 0.5) return "warning";
    return "bad";
  };

  const isMetricVisible = (key) => selectedMetrics.has(key);

  return (
    <div className="ses-dashboard">
      {/* Controls */}
      <div className="ses-toolbar">
        <div className="ses-toolbar-group">
          <span className="ses-toolbar-label">Region</span>
          <div className="ses-region-pills">
            <button
              className={`ses-region-pill${selectedRegions.size === regions.length ? " active" : ""}`}
              onClick={onToggleAllRegions}
            >
              All
            </button>
            {regions.map((r) => (
              <button
                key={r}
                className={`ses-region-pill${selectedRegions.has(r) ? " active" : ""}`}
                onClick={() => onToggleRegion(r)}
              >
                {r}
              </button>
            ))}
          </div>
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

      {/* Metric Toggle Pills */}
      {hasData && (
        <div className="ses-metric-toggles">
          <span className="ses-toolbar-label">Metrics</span>
          <div className="ses-metric-pills">
            {allMetrics.map((m) => (
              <button
                key={m.key}
                className={`ses-metric-pill${isMetricVisible(m.key) ? " active" : ""}`}
                onClick={() => onToggleMetric(m.key)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      )}

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
            {isMetricVisible("sends") && (
              <div className="ses-card ses-card-sends">
                {notificationsEnabled && (
                  <AlertBell
                    active={activeAlerts?.has("ses-total-sends")}
                    onClick={() =>
                      onAlertSetup({
                        tileId: "ses-total-sends",
                        tileLabel: "Total Sends",
                      })
                    }
                    title="Configure alert for Total Sends"
                  />
                )}
                <div className="ses-card-label">Total Sends</div>
                <div className="ses-card-value">{fmtNum(data.sends)}</div>
                <div className="ses-card-sub">
                  {periodOptions[periodID]?.label ?? ""}
                </div>
              </div>
            )}
            {isMetricVisible("bounces") && (
              <div className="ses-card ses-card-bounces">
                {notificationsEnabled && (
                  <AlertBell
                    active={activeAlerts?.has("ses-bounces")}
                    onClick={() =>
                      onAlertSetup({
                        tileId: "ses-bounces",
                        tileLabel: "Bounces",
                      })
                    }
                    title="Configure alert for Bounces"
                  />
                )}
                <div className="ses-card-label">Bounces</div>
                <div className="ses-card-value">{fmtNum(data.bounces)}</div>
                <div className="ses-card-sub">
                  {fmtNum(data.permanent_bounces)} perm /{" "}
                  {fmtNum(data.transient_bounces)} trans
                </div>
              </div>
            )}
            {isMetricVisible("complaints") && (
              <div className="ses-card ses-card-complaints">
                {notificationsEnabled && (
                  <AlertBell
                    active={activeAlerts?.has("ses-complaints")}
                    onClick={() =>
                      onAlertSetup({
                        tileId: "ses-complaints",
                        tileLabel: "Complaints",
                      })
                    }
                    title="Configure alert for Complaints"
                  />
                )}
                <div className="ses-card-label">Complaints</div>
                <div className="ses-card-value">{fmtNum(data.complaints)}</div>
                <div className="ses-card-sub">Feedback loop reports</div>
              </div>
            )}
            {isMetricVisible("rejects") && (
              <div className="ses-card ses-card-rejects">
                {notificationsEnabled && (
                  <AlertBell
                    active={activeAlerts?.has("ses-rejects")}
                    onClick={() =>
                      onAlertSetup({
                        tileId: "ses-rejects",
                        tileLabel: "Rejects",
                      })
                    }
                    title="Configure alert for Rejects"
                  />
                )}
                <div className="ses-card-label">Rejects</div>
                <div className="ses-card-value">{fmtNum(data.rejects)}</div>
                <div className="ses-card-sub">Rejected by SES</div>
              </div>
            )}
          </div>

          {/* Rate Cards */}
          <div className="ses-rates">
            {isMetricVisible("bounce_rate") && (
              <div className="ses-card ses-card-rate">
                {notificationsEnabled && (
                  <AlertBell
                    active={activeAlerts?.has("ses-bounce-rate")}
                    onClick={() =>
                      onAlertSetup({
                        tileId: "ses-bounce-rate",
                        tileLabel: "Bounce Rate",
                      })
                    }
                    title="Configure alert for Bounce Rate"
                  />
                )}
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
            )}
            {isMetricVisible("complaint_rate") && (
              <div className="ses-card ses-card-rate">
                {notificationsEnabled && (
                  <AlertBell
                    active={activeAlerts?.has("ses-complaint-rate")}
                    onClick={() =>
                      onAlertSetup({
                        tileId: "ses-complaint-rate",
                        tileLabel: "Complaint Rate",
                      })
                    }
                    title="Configure alert for Complaint Rate"
                  />
                )}
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
            )}
            {isMetricVisible("error_rate") && (
              <div className="ses-card ses-card-rate">
                {notificationsEnabled && (
                  <AlertBell
                    active={activeAlerts?.has("ses-error-rate")}
                    onClick={() =>
                      onAlertSetup({
                        tileId: "ses-error-rate",
                        tileLabel: "Error Rate",
                      })
                    }
                    title="Configure alert for Error Rate"
                  />
                )}
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
            )}
          </div>

          {/* Daily Volume Table */}
          {isMetricVisible("daily_volume") &&
            data.daily_volume &&
            data.daily_volume.length > 0 && (
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
                              ? ((day.bounces / day.sends) * 100).toFixed(3) +
                                "%"
                              : "0%"}
                          </td>
                          <td>{fmtNum(day.complaints)}</td>
                          <td>
                            {day.sends > 0
                              ? ((day.complaints / day.sends) * 100).toFixed(
                                  3,
                                ) + "%"
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
