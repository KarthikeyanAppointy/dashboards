import { useEffect } from "react";
import "./RcaReportModal.css";

function formatTimestamp(value) {
  if (!value) return "";
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
  } catch {
    return value;
  }
}

function normalizeItems(items = [], fallback = "") {
  if (Array.isArray(items) && items.length > 0) {
    return items.map((item) => String(item).trim()).filter(Boolean);
  }
  return String(fallback || "")
    .split("\n")
    .map((line) => line.trim().replace(/^[-*•]\s*/, ""))
    .filter(Boolean);
}

function Section({ title, body, items, tone = "default" }) {
  const normalizedItems = normalizeItems(items, body);
  const textBody = String(body || "").trim();
  if (!textBody && normalizedItems.length === 0) {
    return null;
  }

  return (
    <section className={`rca-section rca-section-${tone}`}>
      <h3 className="rca-section-title">{title}</h3>
      {normalizedItems.length > 1 ? (
        <ul className="rca-list">
          {normalizedItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="rca-section-body">
          {normalizedItems[0] || textBody}
        </p>
      )}
    </section>
  );
}

function RcaReportModal({ record, onClose }) {
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!record) return null;

  const title =
    record.rca_title ||
    record.workflow_type ||
    record.workflow_id ||
    "RCA Report";
  const openMRHref = record.open_mr_url || "";
  const openMRLabel =
    record.open_mr_label && record.open_mr_label !== record.open_mr_url
      ? record.open_mr_label
      : openMRHref
        ? "Open MR/PR"
        : "";

  return (
    <div className="rca-overlay" onClick={onClose}>
      <div
        className="rca-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <header className="rca-header">
          <div>
            <p className="rca-eyebrow">Root Cause Analysis</p>
            <h2 className="rca-title">{title}</h2>
            <p className="rca-meta">
              {record.workflow_id || "Unknown workflow"}
              {record.run_id ? ` · ${record.run_id}` : ""}
              {record.event_id ? ` · Event ${record.event_id}` : ""}
            </p>
          </div>
          <button
            type="button"
            className="rca-close"
            onClick={onClose}
            aria-label="Close RCA report"
          >
            ×
          </button>
        </header>

        <div className="rca-toolbar">
          {record.rca_received_at && (
            <span className="rca-chip">
              Received {formatTimestamp(record.rca_received_at)}
            </span>
          )}
          {record.has_customer_impact && (
            <span className="rca-chip rca-chip-impact">Customer impact</span>
          )}
          {openMRLabel && (
            openMRHref ? (
              <a
                className="rca-chip rca-chip-link"
                href={openMRHref}
                target="_blank"
                rel="noreferrer"
              >
                {openMRLabel}
              </a>
            ) : (
              <span className="rca-chip">{openMRLabel}</span>
            )
          )}
        </div>

        <div className="rca-body">
          <Section
            title="Customer Impact"
            body={record.customer_impact_details}
            items={record.customer_impact_items}
            tone="impact"
          />
          <Section title="Summary" body={record.rca_summary} />
          <Section title="Root Cause" body={record.root_cause} />
          <Section title="Remediation" body={record.remediation} />
          <Section title="Current Status" body={record.current_status} />

          {record.raw_report && (
            <section className="rca-section">
              <h3 className="rca-section-title">Raw Report</h3>
              <pre className="rca-raw">{record.raw_report}</pre>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

export default RcaReportModal;
