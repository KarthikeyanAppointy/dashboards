import "./SummaryCards.css";

const CARD_WINDOW_MAP = {
  "30m": "Last 30min",
  "1h": "Last 1hr",
  "24h": "Last 1d",
  "7d": "Last 7d",
  "30d": "Last 30d",
};

function formatLatency(ms) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms.toLocaleString()} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function getWindowLatency(windows, shortLabel) {
  const targetLabel = CARD_WINDOW_MAP[shortLabel];
  const match = windows?.find((w) => w.label === targetLabel);
  return match?.p100_latency_ms ?? null;
}

function RingGauge({ pct }) {
  const radius = 32;
  const circ = 2 * Math.PI * radius;
  const fill = circ * (pct / 100);
  const ringClass = pct >= 95 ? "" : pct >= 80 ? "ring-warning" : "ring-danger";

  return (
    <div className="summary-health-ring-wrap">
      <svg
        className="summary-health-ring-svg"
        width="80"
        height="80"
        viewBox="0 0 80 80"
      >
        <circle className="summary-health-ring-bg" cx="40" cy="40" r={radius} />
        <circle
          className={`summary-health-ring-fill ${ringClass}`}
          cx="40"
          cy="40"
          r={radius}
          strokeDasharray={`${fill} ${circ - fill}`}
          strokeDashoffset="0"
        />
      </svg>
      <div className="summary-health-ring-label">
        <span className="summary-health-score">{pct}%</span>
      </div>
    </div>
  );
}

const AlertBell = ({ active, onClick, title }) => (
  <button
    className={`summary-alert-btn${active ? " active" : ""}`}
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    title={title}
    aria-label={title}
  >
    <svg
      width="13"
      height="13"
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

function SummaryCards({
  rates30min,
  rates1hr,
  rates1d,
  rates7d,
  rates30d,
  selectedRate,
  tasklistWindow,
  windows,
  activeAlerts,
  onAlertSetup,
  notificationsEnabled,
}) {
  const summaryCards = [
    { label: "30m", title: "Last 30 min", data: rates30min },
    { label: "1h", title: "Last 1 hour", data: rates1hr },
    { label: "24h", title: "Last 24 hours", data: rates1d },
    { label: "7d", title: "Last 7 days", data: rates7d },
    { label: "30d", title: "Last 30 days", data: rates30d },
  ];

  // Use the selected window's rate for hero metrics, fall back to 24h
  const heroData =
    selectedRate?.total > 0
      ? selectedRate
      : rates1d || rates1hr || rates30min || rates7d || rates30d;
  const healthScore = heroData?.success_pct ?? 0;
  const attentionRate = heroData?.failure_pct ?? 0;
  const totalVolume = heroData?.total ?? 0;
  const successCount = heroData?.success ?? 0;
  const failureCount = heroData?.failure ?? 0;

  // Determine the label for the selected window
  const windowLabels = {
    3600: "1h",
    10800: "3h",
    21600: "6h",
    43200: "12h",
    86400: "24h",
    604800: "7d",
    2592000: "30d",
  };
  const selectedLabel = windowLabels[tasklistWindow] || "24h";
  const selectedTitle =
    tasklistWindow === 3600
      ? "Last 1 hour"
      : tasklistWindow === 10800
        ? "Last 3 hours"
        : tasklistWindow === 21600
          ? "Last 6 hours"
          : tasklistWindow === 43200
            ? "Last 12 hours"
            : tasklistWindow === 604800
              ? "Last 7 days"
              : tasklistWindow === 2592000
                ? "Last 30 days"
                : "Last 24 hours";

  // Get P100 latency for the selected window from windows array
  const selectedWindowLabel =
    selectedLabel === "1h"
      ? "Last 1hr"
      : selectedLabel === "24h"
        ? "Last 1d"
        : selectedLabel === "30m"
          ? "Last 30min"
          : selectedLabel === "7d"
            ? "Last 7d"
            : selectedLabel === "30d"
              ? "Last 30d"
              : null;
  const selectedWindow = windows?.find((w) => w.label === selectedWindowLabel);
  const p100 = formatLatency(
    selectedWindow?.p100_latency_ms ?? getWindowLatency(windows, "24h"),
  );

  return (
    <section className="summary-board">
      <div className="summary-kpi-row">
        <article className="summary-kpi-tile">
          {notificationsEnabled && (
            <AlertBell
              active={activeAlerts?.has("overview-success-rate")}
              onClick={() =>
                onAlertSetup?.({
                  tileId: "overview-success-rate",
                  tileLabel: "Successful (" + selectedLabel + ")",
                })
              }
              title="Configure alert for Successful"
            />
          )}
          <p className="summary-kpi-tile-label">Successful ({selectedLabel})</p>
          <p className="summary-kpi-tile-value">
            {successCount.toLocaleString()}
          </p>
          <span className="summary-kpi-tile-foot kpi-foot-success">
            {healthScore}% healthy
          </span>
        </article>

        <article className="summary-kpi-tile">
          {notificationsEnabled && (
            <AlertBell
              active={activeAlerts?.has("overview-failure-rate")}
              onClick={() =>
                onAlertSetup?.({
                  tileId: "overview-failure-rate",
                  tileLabel: "Failures (" + selectedLabel + ")",
                })
              }
              title="Configure alert for Failures"
            />
          )}
          <p className="summary-kpi-tile-label">Failures ({selectedLabel})</p>
          <p className="summary-kpi-tile-value">
            {failureCount.toLocaleString()}
          </p>
          <span className="summary-kpi-tile-foot kpi-foot-danger">
            {attentionRate}% failed
          </span>
        </article>

        <article className="summary-kpi-tile">
          {notificationsEnabled && (
            <AlertBell
              active={activeAlerts?.has("overview-total-volume")}
              onClick={() =>
                onAlertSetup?.({
                  tileId: "overview-total-volume",
                  tileLabel: "Total volume (" + selectedLabel + ")",
                })
              }
              title="Configure alert for Total volume"
            />
          )}
          <p className="summary-kpi-tile-label">
            Total volume ({selectedLabel})
          </p>
          <p className="summary-kpi-tile-value">
            {totalVolume.toLocaleString()}
          </p>
          <span className="summary-kpi-tile-foot">Workflows observed</span>
        </article>

        <article className="summary-kpi-tile">
          {notificationsEnabled && (
            <AlertBell
              active={activeAlerts?.has("overview-p100-latency")}
              onClick={() =>
                onAlertSetup?.({
                  tileId: "overview-p100-latency",
                  tileLabel: "P100 latency (" + selectedLabel + ")",
                })
              }
              title="Configure alert for P100 latency"
            />
          )}
          <p className="summary-kpi-tile-label">
            P100 latency ({selectedLabel})
          </p>
          <p className="summary-kpi-tile-value">{p100}</p>
          <span className="summary-kpi-tile-foot">Worst-case completion</span>
        </article>
      </div>

      <div className="summary-health-panel">
        <RingGauge pct={healthScore} />
        <div className="summary-health-meta">
          <p className="summary-health-title">
            Overall health — {healthScore}% success rate
          </p>
          <p className="summary-health-desc">
            Based on the latest {selectedTitle.toLowerCase()} across all
            workflows. P100 latency reflects the slowest observed completion
            path.
          </p>
        </div>
        <div className="summary-health-legend">
          <div className="summary-health-legend-item">
            <span className="legend-dot legend-dot-success" />
            Healthy execution rate
          </div>
          <div className="summary-health-legend-item">
            <span className="legend-dot legend-dot-warning" />
            Failure &amp; timeout share
          </div>
        </div>
      </div>

      <div className="summary-window-strip">
        {summaryCards.map((card) => {
          const windowTileIds = {
            "30m": "overview-window-30m",
            "1h": "overview-window-1h",
            "24h": "overview-window-24h",
            "7d": "overview-window-7d",
            "30d": "overview-window-30d",
          };
          const wTileId = windowTileIds[card.label];
          return (
            <article className="summary-window-card" key={card.label}>
              {notificationsEnabled && (
                <AlertBell
                  active={activeAlerts?.has(wTileId)}
                  onClick={() =>
                    onAlertSetup?.({ tileId: wTileId, tileLabel: card.title })
                  }
                  title={`Configure alert for ${card.title}`}
                />
              )}
              <div className="summary-window-topline">
                <span className="summary-window-badge">{card.label}</span>
                <span className="summary-window-total">
                  {card.data.total.toLocaleString()}
                </span>
              </div>
              <h3>{card.title}</h3>
              <div className="summary-window-stats">
                <div>
                  <span className="summary-window-stat-label">Success</span>
                  <strong>{card.data.success_pct}%</strong>
                </div>
                <div>
                  <span className="summary-window-stat-label">Failed</span>
                  <strong>{card.data.failure_pct}%</strong>
                </div>
              </div>
              <div className="summary-window-bar">
                <span
                  className="summary-window-bar-success"
                  style={{ width: `${card.data.success_pct}%` }}
                />
                <span
                  className="summary-window-bar-failure"
                  style={{ width: `${card.data.failure_pct}%` }}
                />
              </div>
              <p className="summary-window-latency">
                P100 {formatLatency(getWindowLatency(windows, card.label))}
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default SummaryCards;
