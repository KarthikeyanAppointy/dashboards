import { useState } from "react";
import "./TenantManager.css";

export default function TenantManager({ tenants, onTenantsChanged }) {
  const [expanded, setExpanded] = useState(false);
  const [form, setForm] = useState({
    name: "",
    domain_id: "",
    domain_name: "",
    es_endpoint: "",
    es_index: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const handleChange = (field) => (e) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.domain_id.trim() || !form.domain_name.trim())
      return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setForm({
        name: "",
        domain_id: "",
        domain_name: "",
        es_endpoint: "",
        es_index: "",
      });
      if (onTenantsChanged) onTenantsChanged();
    } catch (err) {
      console.error("Failed to add tenant:", err);
      alert(`Failed to add tenant: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this tenant?")) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/tenants/delete?id=${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (onTenantsChanged) onTenantsChanged();
    } catch (err) {
      console.error("Failed to delete tenant:", err);
      alert(`Failed to delete tenant: ${err.message}`);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="tm-container">
      <button className="tm-toggle" onClick={() => setExpanded((e) => !e)}>
        <span
          className={`tm-toggle-icon ${expanded ? "tm-toggle-icon--open" : ""}`}
        >
          &#9654;
        </span>
        Manage Tenants
      </button>

      {expanded && (
        <div className="tm-content">
          {/* Add form */}
          <form className="tm-form" onSubmit={handleAdd}>
            <h4 className="tm-section-title">Add Tenant</h4>
            <div className="tm-form-grid">
              <label className="tm-field">
                <span>Name *</span>
                <input
                  value={form.name}
                  onChange={handleChange("name")}
                  placeholder="e.g. qa-mathnasium"
                  required
                />
              </label>
              <label className="tm-field">
                <span>Domain ID *</span>
                <input
                  value={form.domain_id}
                  onChange={handleChange("domain_id")}
                  placeholder="e.g. qa-mathnasium"
                  required
                />
              </label>
              <label className="tm-field">
                <span>Domain Name *</span>
                <input
                  value={form.domain_name}
                  onChange={handleChange("domain_name")}
                  placeholder="e.g. qa-mathnasium"
                  required
                />
              </label>
              <label className="tm-field">
                <span>ES Endpoint</span>
                <input
                  value={form.es_endpoint}
                  onChange={handleChange("es_endpoint")}
                  placeholder="e.g. http://localhost:9000"
                />
              </label>
              <label className="tm-field">
                <span>ES Index</span>
                <input
                  value={form.es_index}
                  onChange={handleChange("es_index")}
                  placeholder="e.g. cadence-visibility"
                />
              </label>
            </div>
            <button
              type="submit"
              className="tm-btn tm-btn--add"
              disabled={submitting}
            >
              {submitting ? "Adding..." : "Add Tenant"}
            </button>
          </form>

          {/* Tenant list */}
          <div className="tm-list-section">
            <h4 className="tm-section-title">
              Existing Tenants ({tenants.length})
            </h4>
            {tenants.length === 0 ? (
              <p className="tm-empty">No tenants configured.</p>
            ) : (
              <ul className="tm-list">
                {tenants.map((t) => (
                  <li key={t.id} className="tm-list-item">
                    <div className="tm-list-info">
                      <strong>{t.name}</strong>
                      <span className="tm-list-meta">
                        {t.domain_name}
                        {t.es_endpoint ? ` · ${t.es_endpoint}` : ""}
                      </span>
                    </div>
                    <button
                      className="tm-btn tm-btn--delete"
                      onClick={() => handleDelete(t.id)}
                      disabled={deleting === t.id}
                    >
                      {deleting === t.id ? "..." : "Delete"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
