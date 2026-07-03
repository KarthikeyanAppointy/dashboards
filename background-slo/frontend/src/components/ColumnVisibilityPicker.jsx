import { useEffect, useRef, useState } from "react";
import "./ColumnVisibilityPicker.css";

function ColumnVisibilityPicker({
  options,
  visibleKeys,
  onToggle,
  onReset,
  label = "Columns",
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  return (
    <div className="cvp-container" ref={containerRef}>
      <button
        type="button"
        className={`cvp-trigger${open ? " open" : ""}`}
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {label}
        <span className="cvp-count">{visibleKeys.length}</span>
      </button>

      {open && (
        <div className="cvp-panel" role="dialog" aria-label="Column visibility">
          <div className="cvp-header">
            <span className="cvp-title">Visible columns</span>
            <button type="button" className="cvp-reset" onClick={onReset}>
              Reset
            </button>
          </div>
          <div className="cvp-list">
            {options.map((option) => {
              const checked = visibleKeys.includes(option.key);
              return (
                <label
                  key={option.key}
                  className={`cvp-item${checked ? " checked" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(option.key)}
                  />
                  <span>{option.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default ColumnVisibilityPicker;
