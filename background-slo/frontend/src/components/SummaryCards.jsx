import "./SummaryCards.css";

function SummaryCards({ rates30min, rates1hr, rates1d, rates7d, rates30d }) {
  const cards = [
    { title: "Last 30 Minutes", ...rates30min },
    { title: "Last 1 Hour", ...rates1hr },
    { title: "Last 24 Hours", ...rates1d },
    { title: "Last 7 Days", ...rates7d },
    { title: "Last 30 Days", ...rates30d },
  ];

  return (
    <div className="summary-cards">
      {cards.map((card, index) => (
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
            <span className="card-total">
              Total: {card.total.toLocaleString()}
            </span>
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
      ))}
    </div>
  );
}

export default SummaryCards;
