import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../auth/AuthContext";
import "./TenantsPage.css";

export default function TenantsPage({ showSnackbar }) {
  const { authFetch } = useAuth();
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const [form, setForm] = useState({
    name: "",
    domain_id: "",
    domain_name: "",
    es_endpoint: "",
    es_index: "",
    es_api_key: "",
    audience_url: "",
    notifyhub_url: "",
    notifyhub_api_key: "",
  });

  const fetchTenants = useCallback(async () => {
    try {
      const res = await authFetch("/api/tenants");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = await res.json();
      setTenants(list);
    } catch (err) {
      console.error("Failed to load tenants:", err);
      showSnackbar?.("Failed to load tenants", "error");
    } finally {
      setLoading(false);
    }
  }, [showSnackbar, authFetch]);

  useEffect(() => {
    fetchTenants();
  }, [fetchTenants]);

  const handleChange = (field) => (e) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const resetForm = () =>
    setForm({
      name: "",
      domain_id: "",
      domain_name: "",
      es_endpoint: "",
      es_index: "",
      es_api_key: "",
      audience_url: "",
      notifyhub_url: "",
      notifyhub_api_key: "",
    });

  const openAddModal = () => {
    resetForm();
    setShowAddModal(true);
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    if (
      !form.name.trim() ||
      !form.domain_id.trim() ||
      !form.domain_name.trim()
    ) {
      showSnackbar?.("Name, Domain ID, and Domain Name are required", "error");
      return;
    }
    setSubmitting(true);
    try {
      const body = { ...form };
      if (!body.es_endpoint) delete body.es_endpoint;
      if (!body.es_index) delete body.es_index;
      if (!body.es_api_key) delete body.es_api_key;
      if (!body.audience_url) delete body.audience_url;
      if (!body.notifyhub_url) delete body.notifyhub_url;
      if (!body.notifyhub_api_key) delete body.notifyhub_api_key;

      const res = await authFetch("/api/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      resetForm();
      setShowAddModal(false);
      showSnackbar?.("Client added successfully", "success");
      fetchTenants();
    } catch (err) {
      showSnackbar?.(`Failed to add client: ${err.message}`, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    setDeleting(id);
    try {
      const res = await authFetch(`/api/tenants/delete?id=${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showSnackbar?.("Client deleted", "success");
      fetchTenants();
    } catch (err) {
      showSnackbar?.(`Failed to delete client: ${err.message}`, "error");
    } finally {
      setDeleting(null);
    }
  };

  const confirmDelete = (tenant) => {
    if (window.confirm(`Are you sure you want to remove "${tenant.name}"?`)) {
      handleDelete(tenant.id);
    }
  };

  const renderField = (
    label,
    field,
    placeholder,
    required = false,
    type = "text",
  ) => (
    <div className="tp-field">
      <label className="tp-field-label">
        {label}
        {required && <span className="tp-required">*</span>}
      </label>
      <input
        className="tp-field-input"
        type={type}
        value={form[field]}
        onChange={handleChange(field)}
        placeholder={placeholder}
        required={required}
      />
    </div>
  );

  if (loading) {
    return (
      <div className="tp-page">
        <div className="tp-loading">
          <div className="spinner" />
          <span>Loading clients...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="tp-page">
      <div className="tp-header">
        <div className="tp-header-left">
          <h1 className="tp-title">Clients</h1>
          <p className="tp-description">Manage and configure client tenants</p>
        </div>
        <button className="tp-btn tp-btn-primary" onClick={openAddModal}>
          <svg
            className="tp-btn-icon"
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
          >
            <path
              d="M7 1v12M1 7h12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          Add Client
        </button>
      </div>

      <div className="tp-table-wrap">
        {tenants.length === 0 ? (
          <div className="tp-empty">
            <div className="tp-empty-icon">
              <svg
                width="36"
                height="36"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <path d="M8 21h8" />
                <path d="M12 17v4" />
              </svg>
            </div>
            <p className="tp-empty-text">No clients configured yet</p>
            <p className="tp-empty-hint">
              Add a client to get started with tenant management.
            </p>
          </div>
        ) : (
          <table className="tp-table">
            <thead>
              <tr>
                <th className="tp-th tp-col-name">Client Name</th>
                <th className="tp-th tp-col-domain">Domain</th>
                <th className="tp-th tp-col-endpoint">ES Endpoint</th>
                <th className="tp-th tp-col-index">ES Index</th>
                <th className="tp-th tp-col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((tenant) => (
                <tr key={tenant.id}>
                  <td className="tp-td tp-col-name">
                    <span className="tp-tenant-name">{tenant.name}</span>
                  </td>
                  <td className="tp-td tp-col-domain">
                    <span className="tp-tenant-domain">
                      {tenant.domain_name}
                    </span>
                  </td>
                  <td className="tp-td tp-col-endpoint">
                    <code className="tp-endpoint-code">
                      {tenant.es_endpoint}
                    </code>
                  </td>
                  <td className="tp-td tp-col-index">
                    <span className="tp-index-badge">{tenant.es_index}</span>
                  </td>
                  <td className="tp-td tp-col-actions">
                    <button
                      className="tp-btn tp-btn-icon-only tp-btn-delete"
                      title={`Remove ${tenant.name}`}
                      disabled={deleting === tenant.id}
                      onClick={() => confirmDelete(tenant)}
                    >
                      {deleting === tenant.id ? (
                        <div className="tp-spinner-xs" />
                      ) : (
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 14 14"
                          fill="none"
                        >
                          <path
                            d="M2 4h10M5 4V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V4M3 4v7.5a1 1 0 001 1h6a1 1 0 001-1V4"
                            stroke="currentColor"
                            strokeWidth="1.3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAddModal && (
        <div className="tp-overlay" onClick={() => setShowAddModal(false)}>
          <div className="tp-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tp-modal-header">
              <h2 className="tp-modal-title">Add Client</h2>
              <p className="tp-modal-desc">
                Configure a new client tenant with Elasticsearch and
                notification settings.
              </p>
            </div>
            <form className="tp-modal-body" onSubmit={handleAdd}>
              <div className="tp-modal-section">
                <h3 className="tp-modal-section-title">General Information</h3>
                <div className="tp-modal-grid">
                  {renderField(
                    "Client Name",
                    "name",
                    "e.g. qa-mathnasium",
                    true,
                  )}
                  {renderField("Domain ID", "domain_id", "UUID", true)}
                  {renderField(
                    "Domain Name",
                    "domain_name",
                    "e.g. qa-mathnasium",
                    true,
                  )}
                </div>
              </div>
              <div className="tp-modal-section">
                <h3 className="tp-modal-section-title">
                  Elasticsearch Connection
                </h3>
                <div className="tp-modal-grid">
                  {renderField(
                    "ES Endpoint",
                    "es_endpoint",
                    "http://localhost:9000",
                    false,
                  )}
                  {renderField(
                    "ES Index",
                    "es_index",
                    "cadence-visibility",
                    false,
                  )}
                  {renderField(
                    "Audience URL",
                    "audience_url",
                    "e.g. qa-mathnasium-admin.appointy.com",
                    false,
                    "text",
                  )}
                </div>
              </div>
              <div className="tp-modal-section">
                <h3 className="tp-modal-section-title">NotifyHub (Optional)</h3>
                <div className="tp-modal-grid">
                  {renderField(
                    "NotifyHub URL",
                    "notifyhub_url",
                    "https://notifyhub.example.com",
                    false,
                  )}
                  {renderField(
                    "NotifyHub API Key",
                    "notifyhub_api_key",
                    "API key",
                    false,
                    "password",
                  )}
                </div>
              </div>
              <div className="tp-modal-actions">
                <button
                  type="button"
                  className="tp-btn tp-btn-secondary"
                  onClick={() => setShowAddModal(false)}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="tp-btn tp-btn-primary"
                  disabled={submitting}
                >
                  {submitting ? (
                    <>
                      <div className="tp-spinner-xs" /> Adding...
                    </>
                  ) : (
                    "Add Client"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
