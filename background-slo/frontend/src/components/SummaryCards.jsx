import "./SummaryCards.css";

// Map card titles to window labels in the windows array
const CARD_WINDOW_MAP = {
  "Last 30 Minutes": "Last 30min",
  "Last 1 Hour": "Last 1hr",
  "Last 24 Hours": "Last 1d",
  "Last 7 Days": "Last 7d",
  "Last 30 Days": "Last 30d",
};

function formatLatency(ms) {
  if (!ms || ms === 0) return null;
  if (ms < 1000) return `${ms.toLocaleString()} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function findP100Latency(windows, cardTitle) {
  if (!windows || windows.length === 0) return null;
  const targetLabel = CARD_WINDOW_MAP[cardTitle];
  if (!targetLabel) return null;
  const match = windows.find((w) => w.label === targetLabel);
  return match ? match.p100_latency_ms : null;
}

function SummaryCards({
  rates30min,
  rates1hr,
  rates1d,
  rates7d,
  rates30d,
  windows,
}) {
  const cards = [
    { title: "Last 30 Minutes", ...rates30min },
    { title: "Last 1 Hour", ...rates1hr },
    { title: "Last 24 Hours", ...rates1d },
    { title: "Last 7 Days", ...rates7d },
    { title: "Last 30 Days", ...rates30d },
  ];

  return (
    <div className="summary-cards">
      {cards.map((card, index) => {
        const p100Ms = findP100Latency(windows, card.title);
        const p100Formatted = formatLatency(p100Ms);

        return (
          <div className="summary-card" key={index}>
            <div className="card-header">
              <h3 className="card-title">{card.title}</h3>
            </div>
            <div className="card-body">
              <div className="card-metric success-metric">
                <div className="metric-value">{card.success_pct}%</div>
                <div className="metric-label">Success</div>
                <div className="metric-sub">
                  {card.success.toLocaleString()} workflows
                </div>
              </div>
              <div className="card-divider"></div>
              <div className="card-metric failure-metric">
                <div className="metric-value">{card.failure_pct}%</div>
                <div className="metric-label">Failed / Timed Out</div>
                <div className="metric-sub">
                  {card.failure.toLocaleString()} workflows
                </div>
              </div>
            </div>
            <div className="card-footer">
              <div className="card-footer-stats">
                <span className="card-total">
                  Total: {card.total.toLocaleString()}
                </span>
                {p100Formatted && (
                  <span className="card-p100-latency">
                    P100 Latency: {p100Formatted}
                  </span>
                )}
              </div>
              <div className="card-bar">
                <div
                  className="card-bar-success"
                  style={{ width: `${card.success_pct}%` }}
                ></div>
                <div
                  className="card-bar-failure"
                  style={{ width: `${card.failure_pct}%` }}
                ></div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default SummaryCards;
