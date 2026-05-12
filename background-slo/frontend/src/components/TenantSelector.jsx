import { useState, useRef, useEffect } from "react";
import "./TenantSelector.css";

export default function TenantSelector({
  tenants,
  selectedTenantId,
  onSelect,
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const selected = tenants.find((t) => t.id === selectedTenantId);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="ts-container" ref={containerRef}>
      <button
        className="ts-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="ts-name">{selected?.name ?? "Select Tenant"}</span>
        <span className={`ts-arrow ${open ? "ts-arrow--open" : ""}`}>&#9662;</span>
      </button>

      {open && (
        <ul className="ts-dropdown" role="listbox">
          {tenants.map((t) => (
            <li
              key={t.id}
              className={`ts-item ${
                t.id === selectedTenantId ? "ts-item--active" : ""
              }`}
              role="option"
              aria-selected={t.id === selectedTenantId}
              onClick={() => {
                onSelect(t.id);
                setOpen(false);
              }}
            >
              <span className="ts-item-name">{t.name}</span>
              {t.id === selectedTenantId && (
                <span className="ts-item-check">&#10003;</span>
              )}
            </li>
          ))}
          {tenants.length === 0 && (
            <li className="ts-item ts-item--empty" role="option">
              No tenants available
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
