import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../auth/AuthContext";
import "./PeoplesPage.css";

const DEFAULT_SECTION_PERMISSIONS = [
  "overview",
  "failures",
  "activity-errors",
  "p100-latency",
  "ses",
  "pipeline-requests",
];

const PERSONA_OPTIONS = ["Developer", "QA", "CEAM"];

function formatLastActive(dateStr) {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

const SIDEBAR_SECTIONS = [
  { key: "admin", label: "Clients (Admin)" },
  { key: "overview", label: "Overview" },
  { key: "failures", label: "Recent Failures" },
  { key: "activity-errors", label: "Activity Errors" },
  { key: "p100-latency", label: "P100 Latency" },
  { key: "ses", label: "SES Dashboard" },
  { key: "pipeline-requests", label: "Pipeline Requests" },
  { key: "notifications", label: "Notifications" },
  { key: "report-history", label: "Reports" },
  { key: "peoples", label: "People" },
];

function samePermissions(left = [], right = []) {
  if (left.length !== right.length) return false;
  const leftSet = new Set(left);
  return right.every((permission) => leftSet.has(permission));
}

/* ── Avatar helper ─────────────────────────────────────────── */
function Avatar({ user, size = 32 }) {
  return user.picture ? (
    <img
      src={user.picture}
      alt={user.name || user.user_email}
      className="pp-avatar"
      style={{ width: size, height: size }}
      referrerPolicy="no-referrer"
    />
  ) : (
    <div
      className="pp-avatar pp-avatar-initials"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {(user.name || user.user_email || "?")[0].toUpperCase()}
    </div>
  );
}

/* ── Detail panel ──────────────────────────────────────────── */
function DetailPanel({
  user,
  isCurrentUser,
  isAdmin,
  userTenants,
  allTenants,
  adminTenants,
  saving,
  assigning,
  onRoleChange,
  onPersonaChange,
  onPersonaSave,
  onAssign,
  onPermissionsSave,
  onRemoveTenant,
  onRemovePerson,
}) {
  const [showAssign, setShowAssign] = useState(false);
  const [assignTenantId, setAssignTenantId] = useState("");
  const [permissions, setPermissions] = useState([]);
  const [selectedPermissions, setSelectedPermissions] = useState(
    user.permissions || [],
  );

  // reset assign form when user changes
  useEffect(() => {
    setShowAssign(false);
    setAssignTenantId("");
    setPermissions(DEFAULT_SECTION_PERMISSIONS);
    setSelectedPermissions(user.permissions || []);
  }, [user.permissions, user.user_email]);

  const togglePerm = (key) =>
    setPermissions((p) =>
      p.includes(key) ? p.filter((x) => x !== key) : [...p, key],
    );

  const toggleSelectedPerm = (key) =>
    setSelectedPermissions((current) =>
      current.includes(key)
        ? current.filter((permission) => permission !== key)
        : [...current, key],
    );

  const handleAssignSubmit = async () => {
    if (!assignTenantId) return;
    await onAssign(user.user_email, Number(assignTenantId), permissions);
    setShowAssign(false);
    setAssignTenantId("");
    setPermissions(DEFAULT_SECTION_PERMISSIONS);
  };

  const hasPermissionChanges = !samePermissions(
    selectedPermissions,
    user.permissions || [],
  );

  const assignableTenants = allTenants.filter(
    (t) =>
      !(userTenants || []).some((ut) => ut.tenant_id === t.id) &&
      adminTenants.some((at) => at.tenant_id === t.id),
  );

  const lastActive = formatLastActive(user.last_activity);

  return (
    <div className="pp-detail">
      {/* ── user hero ─────────────────────────────────────────── */}
      <div className="pp-detail-hero">
        <div className="pp-detail-avatar-wrap">
          <Avatar user={user} size={56} />
          <span className={`pp-status-dot${user.signed_in ? " online" : ""}`} />
        </div>
        <div className="pp-detail-hero-info">
          <div className="pp-detail-name-row">
            <h2 className="pp-detail-name">{user.name || "Unknown"}</h2>
            {isCurrentUser && <span className="pp-you-badge">You</span>}
          </div>
          <p className="pp-detail-email">{user.user_email}</p>
          <p className="pp-detail-activity">
            {user.signed_in ? (
              <>
                <span className="pp-dot-online" />
                Active now {lastActive ? `· ${lastActive}` : ""}
              </>
            ) : lastActive ? (
              `Last active ${lastActive}`
            ) : (
              "Never active"
            )}
          </p>
        </div>
      </div>

      {/* ── role section ──────────────────────────────────────── */}
      <div className="pp-detail-section">
        <span className="pp-detail-section-label">Role</span>
        {isAdmin && !isCurrentUser ? (
          <div className="pp-role-toggle">
            {["user", "admin"].map((r) => (
              <button
                key={r}
                className={`pp-role-btn${user.role === r ? " active" : ""}`}
                onClick={() =>
                  user.role !== r && onRoleChange(user.user_email, r)
                }
                disabled={saving}
              >
                {r === "user" ? "User" : "Admin"}
              </button>
            ))}
          </div>
        ) : (
          <span
            className={`pp-role-badge${user.role === "admin" ? " is-admin" : ""}`}
          >
            {user.role === "admin" ? "Admin" : "User"}
          </span>
        )}
      </div>

      <div className="pp-detail-section">
        <span className="pp-detail-section-label">Persona label</span>
        {isAdmin ? (
          <div className="pp-persona-row">
            <select
              className="pp-persona-input"
              value={user.persona || "Developer"}
              onChange={(event) =>
                onPersonaChange(user.user_email, event.target.value)
              }
              disabled={saving}
            >
              {PERSONA_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <button
              className="pp-assign-submit"
              onClick={() => onPersonaSave(user.user_email)}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save label"}
            </button>
          </div>
        ) : (
          <span className="pp-role-badge">{user.persona || "Developer"}</span>
        )}
      </div>

      <div className="pp-detail-section">
        <span className="pp-detail-section-label">Section access</span>
        {isAdmin && !isCurrentUser ? (
          <>
            <div className="pp-perm-grid">
              {SIDEBAR_SECTIONS.map((section) => (
                <button
                  key={section.key}
                  type="button"
                  className={`pp-perm-chip${selectedPermissions.includes(section.key) ? " active" : ""}`}
                  onClick={() => toggleSelectedPerm(section.key)}
                  disabled={saving}
                >
                  {section.label}
                </button>
              ))}
            </div>
            <button
              className="pp-assign-submit"
              onClick={() =>
                onPermissionsSave(user.user_email, selectedPermissions)
              }
              disabled={saving || !hasPermissionChanges}
            >
              {saving ? "Saving…" : "Save access"}
            </button>
          </>
        ) : (user.permissions || []).length > 0 ? (
          <div className="pp-perm-grid">
            {SIDEBAR_SECTIONS.filter((section) =>
              (user.permissions || []).includes(section.key),
            ).map((section) => (
              <button
                key={section.key}
                type="button"
                className="pp-perm-chip active"
                disabled
              >
                {section.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="pp-no-access-stack">
            <p className="pp-no-access">No section access assigned yet.</p>
            {(userTenants || []).length > 0 && (
              <p className="pp-access-warning">
                This person has client access, but no sections yet. Grant
                section permissions to let them use the dashboard.
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── client access section ─────────────────────────────── */}
      {isAdmin && (
        <div className="pp-detail-section pp-detail-section-access">
          <div className="pp-detail-section-header">
            <span className="pp-detail-section-label">Client access</span>
            {!isCurrentUser && assignableTenants.length > 0 && !showAssign && (
              <button
                className="pp-add-btn"
                onClick={() => setShowAssign(true)}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <line
                    x1="5"
                    y1="1"
                    x2="5"
                    y2="9"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                  <line
                    x1="1"
                    y1="5"
                    x2="9"
                    y2="5"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
                Add
              </button>
            )}
          </div>

          {/* tenant chips */}
          {(userTenants || []).length === 0 && !showAssign ? (
            <p className="pp-no-access">No clients assigned yet.</p>
          ) : (
            <div className="pp-tenant-chips">
              {(userTenants || []).map((ut) => (
                <span key={ut.tenant_id} className="pp-tenant-chip">
                  <span className="pp-tenant-chip-name">{ut.tenant_name}</span>
                  <span
                    className={`pp-tenant-chip-role${ut.role === "admin" ? " is-admin" : ""}`}
                  >
                    {ut.role}
                  </span>
                  {!isCurrentUser && (
                    <button
                      className="pp-tenant-chip-remove"
                      onClick={() =>
                        onRemoveTenant(user.user_email, ut.tenant_id)
                      }
                      disabled={assigning}
                      title={`Remove from ${ut.tenant_name}`}
                    >
                      <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                        <line
                          x1="1"
                          y1="1"
                          x2="7"
                          y2="7"
                          stroke="currentColor"
                          strokeWidth="1.3"
                          strokeLinecap="round"
                        />
                        <line
                          x1="7"
                          y1="1"
                          x2="1"
                          y2="7"
                          stroke="currentColor"
                          strokeWidth="1.3"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}

          {/* inline assign form */}
          {showAssign && (
            <div className="pp-assign-form">
              <div className="pp-assign-form-header">
                <span className="pp-assign-form-title">Assign to client</span>
                <button
                  className="pp-assign-cancel"
                  onClick={() => {
                    setShowAssign(false);
                    setAssignTenantId("");
                    setPermissions(DEFAULT_SECTION_PERMISSIONS);
                  }}
                  disabled={assigning}
                >
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                    <line
                      x1="1"
                      y1="1"
                      x2="10"
                      y2="10"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                    />
                    <line
                      x1="10"
                      y1="1"
                      x2="1"
                      y2="10"
                      stroke="currentColor"
                      strokeWidth="1.4"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>

              <select
                className="pp-assign-select"
                value={assignTenantId}
                onChange={(e) => {
                  setAssignTenantId(e.target.value);
                  setPermissions(DEFAULT_SECTION_PERMISSIONS);
                }}
                disabled={assigning}
              >
                <option value="">Choose a client…</option>
                {assignableTenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>

              {assignTenantId && (
                <>
                  <div className="pp-assign-perm-label">Section access</div>
                  <div className="pp-perm-grid">
                    {SIDEBAR_SECTIONS.map((s) => (
                      <button
                        key={s.key}
                        type="button"
                        className={`pp-perm-chip${permissions.includes(s.key) ? " active" : ""}`}
                        onClick={() => togglePerm(s.key)}
                        disabled={assigning}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </>
              )}

              <button
                className="pp-assign-submit"
                onClick={handleAssignSubmit}
                disabled={!assignTenantId || assigning}
              >
                {assigning ? "Assigning…" : "Assign"}
              </button>
            </div>
          )}
        </div>
      )}

      {isAdmin && !isCurrentUser && (
        <div className="pp-detail-section">
          <div className="pp-detail-section-header">
            <span className="pp-detail-section-label">Reset access</span>
          </div>
          <p className="pp-access-warning">
            Remove this person from all clients and clear their saved session so
            the account can be set up again.
          </p>
          <button
            className="pp-danger-btn"
            onClick={() => onRemovePerson(user.user_email)}
            disabled={saving || assigning}
          >
            Remove person access
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────── */
function PeoplesPage({ selectedTenantId, showSnackbar }) {
  const { authFetch } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentUser, setCurrentUser] = useState("");
  const [currentRole, setCurrentRole] = useState("");
  const [savingUserId, setSavingUserId] = useState(null);
  const [allTenants, setAllTenants] = useState([]);
  const [userTenants, setUserTenants] = useState({});
  const [adminTenants, setAdminTenants] = useState([]);
  const [assigning, setAssigning] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [query, setQuery] = useState("");

  const fetchUsers = useCallback(async (opts = {}) => {
    if (!selectedTenantId) return;
    const { showLoader = true } = opts;
    try {
      if (showLoader) {
        setLoading(true);
      }
      setError(null);
      const res = await authFetch(
        `/api/rbac/users?tenant_id=${selectedTenantId}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const list = json.users || [];
      setUsers(list);
      setCurrentUser(json.current_user || "");
      setCurrentRole(json.current_role || "user");
      // auto-select first user if nothing selected
      setSelectedEmail((prev) => prev ?? (list[0]?.user_email || null));
    } catch (err) {
      setError(err.message);
    } finally {
      if (showLoader) {
        setLoading(false);
      }
    }
  }, [authFetch, selectedTenantId]);

  const fetchAllTenants = useCallback(async () => {
    try {
      const res = await authFetch("/api/tenants");
      if (!res.ok) return;
      setAllTenants((await res.json()) || []);
    } catch {}
  }, [authFetch]);

  const fetchUserTenants = useCallback(
    async (email) => {
      try {
        const res = await authFetch(
          `/api/rbac/user-tenants?user_email=${encodeURIComponent(email)}`,
        );
        if (!res.ok) return [];
        return await res.json();
      } catch {
        return [];
      }
    },
    [authFetch],
  );

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);
  useEffect(() => {
    if (selectedTenantId) fetchAllTenants();
  }, [fetchAllTenants, selectedTenantId]);

  useEffect(() => {
    if (!users.length) return;
    (async () => {
      const results = await Promise.all(
        users.map((u) => fetchUserTenants(u.user_email)),
      );
      const map = {};
      users.forEach((u, i) => {
        map[u.user_email] = results[i] || [];
      });
      setUserTenants(map);
    })();
  }, [users, fetchUserTenants]);

  useEffect(() => {
    if (!currentUser) return;
    fetchUserTenants(currentUser).then((t) =>
      setAdminTenants((t || []).filter((x) => x.role === "admin")),
    );
  }, [currentUser, fetchUserTenants]);

  const handleRoleChange = async (email, newRole) => {
    const user = users.find((u) => u.user_email === email);
    setSavingUserId(email);

    let updatedPerms = Array.from(
      new Set([...(user?.permissions || []), ...DEFAULT_SECTION_PERMISSIONS]),
    );
    if (newRole === "admin") {
      updatedPerms = Array.from(new Set([...updatedPerms, "admin"]));
    } else {
      updatedPerms = updatedPerms.filter((p) => p !== "admin");
    }

    try {
      const res = await authFetch(`/api/rbac?tenant_id=${selectedTenantId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_email: email,
          role: newRole,
          persona: user?.persona || "Developer",
          permissions: updatedPerms,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchUsers({ showLoader: false });
      showSnackbar("Role updated successfully", "success");
    } catch (err) {
      showSnackbar(err.message, "error");
    } finally {
      setSavingUserId(null);
    }
  };

  const handleAssign = async (email, tenantId, permissions) => {
    setAssigning(true);
    try {
      const res = await authFetch(
        `/api/rbac/user-tenants?tenant_id=${tenantId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_email: email,
            role: "user",
            persona: "Developer",
            permissions,
          }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.detail ?? `HTTP ${res.status}`);
      }
      const updated = await fetchUserTenants(email);
      setUserTenants((prev) => ({ ...prev, [email]: updated }));
      showSnackbar("User assigned to client successfully", "success");
    } catch (err) {
      showSnackbar(err.message, "error");
    } finally {
      setAssigning(false);
    }
  };

  const handlePermissionsSave = async (email, permissions) => {
    const user = users.find((candidate) => candidate.user_email === email);
    if (!user) return;

    setSavingUserId(email);
    try {
      const res = await authFetch(`/api/rbac?tenant_id=${selectedTenantId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_email: email,
          role: user.role || "user",
          persona: user.persona || "Developer",
          permissions,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchUsers({ showLoader: false });
      showSnackbar("Section access updated successfully", "success");
    } catch (err) {
      showSnackbar(err.message, "error");
    } finally {
      setSavingUserId(null);
    }
  };

  const handlePersonaChange = (email, persona) => {
    setUsers((currentUsers) =>
      currentUsers.map((candidate) =>
        candidate.user_email === email
          ? { ...candidate, persona }
          : candidate,
      ),
    );
  };

  const handlePersonaSave = async (email) => {
    const user = users.find((candidate) => candidate.user_email === email);
    if (!user) return;

    setSavingUserId(email);
    try {
      const res = await authFetch(`/api/rbac?tenant_id=${selectedTenantId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_email: email,
          role: user.role || "user",
          persona: user.persona || "Developer",
          permissions: user.permissions || [],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchUsers({ showLoader: false });
      showSnackbar("Persona label updated successfully", "success");
    } catch (err) {
      showSnackbar(err.message, "error");
    } finally {
      setSavingUserId(null);
    }
  };

  const handleRemoveTenant = async (email, tenantId) => {
    try {
      const res = await authFetch(
        `/api/rbac/user-tenants?user_email=${encodeURIComponent(email)}&tenant_id=${tenantId}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.detail ?? `HTTP ${res.status}`);
      }
      const updated = await fetchUserTenants(email);
      setUserTenants((prev) => ({ ...prev, [email]: updated }));
    } catch (err) {
      showSnackbar(err.message, "error");
    }
  };

  const handleRemovePerson = async (email) => {
    const confirmed = window.confirm(
      `Remove all saved access for ${email}? This will remove them from every client and clear the current session.`,
    );
    if (!confirmed) return;

    setSavingUserId(email);
    try {
      const res = await authFetch(
        `/api/rbac/users?tenant_id=${selectedTenantId}&user_email=${encodeURIComponent(email)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.detail ?? `HTTP ${res.status}`);
      }
      await fetchUsers({ showLoader: false });
      setUserTenants((prev) => {
        const next = { ...prev };
        delete next[email];
        return next;
      });
      setSelectedEmail((prev) => (prev === email ? null : prev));
      showSnackbar("Person access removed successfully", "success");
    } catch (err) {
      showSnackbar(err.message, "error");
    } finally {
      setSavingUserId(null);
    }
  };

  const isAdmin = currentRole === "admin";
  const filteredUsers = users.filter((u) => {
    const q = query.toLowerCase();
    return (
      !q ||
      u.user_email.toLowerCase().includes(q) ||
      (u.name || "").toLowerCase().includes(q)
    );
  });
  const selectedUser =
    users.find((u) => u.user_email === selectedEmail) || null;

  return (
    <div className="pp-page">
      {/* ── error banner ──────────────────────────────────────── */}
      {error && (
        <div className="pp-error">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <circle
              cx="6.5"
              cy="6.5"
              r="5.75"
              stroke="currentColor"
              strokeWidth="1.2"
            />
            <line
              x1="6.5"
              y1="4"
              x2="6.5"
              y2="7"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
            <circle cx="6.5" cy="9" r="0.7" fill="currentColor" />
          </svg>
          {error}
          <button className="pp-error-dismiss" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {/* ── finder frame ──────────────────────────────────────── */}
      <div className="pp-finder">
        {/* left rail */}
        <div className="pp-rail">
          <div className="pp-rail-toolbar">
            <div className="pp-search-wrap">
              <svg
                className="pp-search-icon"
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
              >
                <circle
                  cx="5"
                  cy="5"
                  r="4"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
                <line
                  x1="8.5"
                  y1="8.5"
                  x2="11"
                  y2="11"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              </svg>
              <input
                className="pp-search"
                placeholder="Filter…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button
                  className="pp-search-clear"
                  onClick={() => setQuery("")}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <line
                      x1="1"
                      y1="1"
                      x2="9"
                      y2="9"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                    />
                    <line
                      x1="9"
                      y1="1"
                      x2="1"
                      y2="9"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              )}
            </div>
            <button
              className="pp-rail-refresh"
              onClick={fetchUsers}
              disabled={loading}
              title="Refresh"
            >
              <svg width="12" height="12" viewBox="0 0 13 13" fill="none">
                <path
                  d="M11.5 6.5A5 5 0 112.5 3.5"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
                <polyline
                  points="9,1 11.5,3.5 9,6"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>

          <div className="pp-rail-count">
            {filteredUsers.length}{" "}
            {filteredUsers.length === 1 ? "member" : "members"}
            {users.filter((u) => u.signed_in).length > 0 && (
              <span className="pp-rail-online-count">
                · {users.filter((u) => u.signed_in).length} online
              </span>
            )}
          </div>

          {loading ? (
            <div className="pp-rail-loading">
              <div className="spinner" />
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="pp-rail-empty">No members found</div>
          ) : (
            <div className="pp-rail-list">
              {filteredUsers.map((user) => (
                <button
                  key={user.user_email}
                  className={`pp-rail-row${selectedEmail === user.user_email ? " active" : ""}`}
                  onClick={() => setSelectedEmail(user.user_email)}
                >
                  <div className="pp-rail-avatar-wrap">
                    <Avatar user={user} size={30} />
                    <span
                      className={`pp-status-dot${user.signed_in ? " online" : ""}`}
                    />
                  </div>
                  <div className="pp-rail-row-info">
                    <span className="pp-rail-row-name">
                      {user.name || user.user_email.split("@")[0]}
                      {user.user_email === currentUser && (
                        <span className="pp-rail-you"> (you)</span>
                      )}
                    </span>
                    <span className="pp-rail-row-email">{user.user_email}</span>
                  </div>
                  <span
                    className={`pp-rail-role-dot${user.role === "admin" ? " is-admin" : ""}`}
                    title={user.role}
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* right detail */}
        <div className="pp-detail-pane">
          {!selectedUser ? (
            <div className="pp-detail-placeholder">
              <svg
                width="36"
                height="36"
                viewBox="0 0 36 36"
                fill="none"
                opacity="0.25"
              >
                <circle
                  cx="14"
                  cy="12"
                  r="6"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path
                  d="M2 32c0-6.627 5.373-12 12-12s12 5.373 12 12"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <path
                  d="M26 8v8M30 12h-8"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              <p>Select a member</p>
            </div>
          ) : (
            <DetailPanel
              key={selectedUser.user_email}
              user={selectedUser}
              isCurrentUser={selectedUser.user_email === currentUser}
              isAdmin={isAdmin}
              userTenants={userTenants[selectedUser.user_email]}
              allTenants={allTenants}
              adminTenants={adminTenants}
              saving={savingUserId === selectedUser.user_email}
              assigning={assigning}
              onRoleChange={handleRoleChange}
              onPersonaChange={handlePersonaChange}
              onPersonaSave={handlePersonaSave}
              onAssign={handleAssign}
              onPermissionsSave={handlePermissionsSave}
              onRemoveTenant={handleRemoveTenant}
              onRemovePerson={handleRemovePerson}
            />
          )}
        </div>
      </div>

      {!isAdmin && !loading && (
        <p className="pp-readonly-note">
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <circle
              cx="5.5"
              cy="5.5"
              r="4.75"
              stroke="currentColor"
              strokeWidth="1.1"
            />
            <line
              x1="5.5"
              y1="3.5"
              x2="5.5"
              y2="5.5"
              stroke="currentColor"
              strokeWidth="1.1"
              strokeLinecap="round"
            />
            <circle cx="5.5" cy="7.5" r="0.6" fill="currentColor" />
          </svg>
          Read-only — contact an admin to change roles, section access, or
          client access.
        </p>
      )}
    </div>
  );
}

export default PeoplesPage;
