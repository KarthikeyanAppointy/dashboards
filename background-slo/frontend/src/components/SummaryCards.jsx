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
  const ringClass =
    pct >= 95 ? "" : pct >= 80 ? "ring-warning" : "ring-danger";

  return (
    <div className="summary-health-ring-wrap">
      <svg
        className="summary-health-ring-svg"
        width="80"
        height="80"
        viewBox="0 0 80 80"
      >
        <circle
          className="summary-health-ring-bg"
          cx="40"
          cy="40"
          r={radius}
        />
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

function SummaryCards({
  rates30min,
  rates1hr,
  rates1d,
  rates7d,
  rates30d,
  windows,
}) {
  const summaryCards = [
    { label: "30m", title: "Last 30 min", data: rates30min },
    { label: "1h", title: "Last 1 hour", data: rates1hr },
    { label: "24h", title: "Last 24 hours", data: rates1d },
    { label: "7d", title: "Last 7 days", data: rates7d },
    { label: "30d", title: "Last 30 days", data: rates30d },
  ];

  const heroData = rates1d || rates1hr || rates30min || rates7d || rates30d;
  const healthScore = heroData?.success_pct ?? 0;
  const attentionRate = heroData?.failure_pct ?? 0;
  const totalVolume = heroData?.total ?? 0;
  const successCount = heroData?.success ?? 0;
  const failureCount = heroData?.failure ?? 0;
  const p100 = formatLatency(getWindowLatency(windows, "24h"));

  return (
    <section className="summary-board">
      <div className="summary-kpi-row">
        <article className="summary-kpi-tile">
          <p className="summary-kpi-tile-label">Successful (24h)</p>
          <p className="summary-kpi-tile-value">{successCount.toLocaleString()}</p>
          <span className="summary-kpi-tile-foot kpi-foot-success">
            {healthScore}% healthy
          </span>
        </article>

        <article className="summary-kpi-tile">
          <p className="summary-kpi-tile-label">Failures (24h)</p>
          <p className="summary-kpi-tile-value">{failureCount.toLocaleString()}</p>
          <span className="summary-kpi-tile-foot kpi-foot-danger">
            {attentionRate}% failed
          </span>
        </article>

        <article className="summary-kpi-tile">
          <p className="summary-kpi-tile-label">Total volume (24h)</p>
          <p className="summary-kpi-tile-value">{totalVolume.toLocaleString()}</p>
          <span className="summary-kpi-tile-foot">Workflows observed</span>
        </article>

        <article className="summary-kpi-tile">
          <p className="summary-kpi-tile-label">P100 latency (24h)</p>
          <p className="summary-kpi-tile-value">{p100}</p>
          <span className="summary-kpi-tile-foot">Worst-case completion</span>
        </article>
      </div>

      <div className="summary-health-panel">
        <RingGauge pct={healthScore} />
        <div className="summary-health-meta">
          <p className="summary-health-title">Overall health — {healthScore}% success rate</p>
          <p className="summary-health-desc">
            Based on the latest 24-hour window across all workflows. P100 latency
            reflects the slowest observed completion path.
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
        {summaryCards.map((card) => (
          <article className="summary-window-card" key={card.label}>
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
        ))}
      </div>
    </section>
  );
}

export default SummaryCards;
