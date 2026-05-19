import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../auth/AuthContext";
import "./PeoplesPage.css";

function WelcomePage({ onAccessGranted }) {
  const { user, authFetch } = useAuth();
  const [admins, setAdmins] = useState([]);
  const [checking, setChecking] = useState(true);

  const checkAccess = useCallback(async () => {
    try {
      setChecking(true);
      const res = await authFetch("/api/rbac/my-access");
      if (res.ok) {
        const json = await res.json();
        setAdmins(json.admins || []);
        if (json.has_access) {
          onAccessGranted && onAccessGranted();
          return;
        }
      }
    } catch {
      // ignore
    } finally {
      setChecking(false);
    }
  }, [authFetch, onAccessGranted]);

  useEffect(() => {
    checkAccess();
  }, [checkAccess]);

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "calc(100vh - 64px)",
      padding: 40,
    }}>
      <div style={{
        maxWidth: 480,
        width: "100%",
        textAlign: "center",
      }}>
        {/* Avatar / Welcome icon */}
        <div style={{
          width: 72,
          height: 72,
          borderRadius: 36,
          background: "var(--accent-bg)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 24px",
          fontSize: 28,
          fontWeight: 600,
          color: "var(--accent)",
        }}>
          {(user?.name || user?.email || "?")[0].toUpperCase()}
        </div>

        <h1 style={{
          fontSize: 22,
          fontWeight: 700,
          color: "var(--fg)",
          margin: "0 0 8px",
          letterSpacing: "-0.02em",
        }}>
          Welcome to Background SLO
        </h1>

        <p style={{
          fontSize: 14,
          color: "var(--fg-secondary)",
          margin: "0 0 32px",
          lineHeight: 1.5,
        }}>
          Your account is pending access approval. Please contact one of the
          administrators below to get access.
        </p>

        {checking && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "var(--fg-tertiary)", fontSize: 13 }}>
            <div className="spinner" style={{ width: 14, height: 14, borderWidth: 1.5 }} />
            <span>Checking access...</span>
          </div>
        )}

        {!checking && admins.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 32 }}>
            <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--fg-tertiary)" }}>
              Administrators
            </div>
            {admins.map((admin) => (
              <div key={admin.email} style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 16px",
                borderRadius: 10,
                border: "1px solid var(--separator)",
                background: "var(--surface)",
                textAlign: "left",
              }}>
                {admin.picture ? (
                  <img src={admin.picture} alt={admin.name || admin.email} style={{ width: 36, height: 36, borderRadius: 18, objectFit: "cover" }} />
                ) : (
                  <div style={{ width: 36, height: 36, borderRadius: 18, background: "var(--accent-bg)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 600, color: "var(--accent)" }}>
                    {(admin.name || admin.email || "?")[0].toUpperCase()}
                  </div>
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--fg)" }}>
                    {admin.name || "Admin"}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--fg-secondary)", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {admin.email}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {!checking && admins.length === 0 && (
          <p style={{ fontSize: 13, color: "var(--fg-tertiary)", marginBottom: 24 }}>
            No administrators found. Contact your system administrator to set up access.
          </p>
        )}

        <button
          onClick={checkAccess}
          disabled={checking}
          style={{
            height: 34,
            padding: "0 20px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--surface)",
            color: "var(--fg)",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            fontFamily: "inherit",
            transition: "all 0.12s ease",
          }}
        >
          {checking ? "Checking..." : "Check Again"}
        </button>
      </div>
    </div>
  );
}

export default WelcomePage;
