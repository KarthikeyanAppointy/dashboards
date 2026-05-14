import { useState, useEffect, useRef } from "react";
import { useAuth } from "../auth/AuthContext";
import "./LoginPage.css";

export default function LoginPage() {
  const { signIn } = useAuth();
  const [error, setError]     = useState(null);
  const [loading, setLoading] = useState(false);
  const btnRef = useRef(null);

  useEffect(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) {
      setError("VITE_GOOGLE_CLIENT_ID is not set.");
      return;
    }

    const init = () => {
      if (!window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: handleCredential,
        auto_select: false,
      });
      if (btnRef.current) {
        window.google.accounts.id.renderButton(btnRef.current, {
          theme: "outline",
          size: "large",
          width: 260,
          text: "signin_with",
          shape: "rectangular",
          logo_alignment: "left",
        });
      }
    };

    if (window.google?.accounts?.id) {
      init();
    } else {
      const interval = setInterval(() => {
        if (window.google?.accounts?.id) { clearInterval(interval); init(); }
      }, 80);
      return () => clearInterval(interval);
    }
  }, []);

  const handleCredential = async (response) => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential: response.credential }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Sign-in failed");
        return;
      }
      signIn(data.token, { email: data.email, name: data.name, picture: data.picture });
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  };

  const isDomainError = error?.includes("appointy.com");

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <img
            src="https://cdn.appointy.com/master/images/branding/icon.png"
            alt="Appointy"
            className="login-logo"
          />
          <span className="login-app-name">Background SLO</span>
        </div>

        <h1 className="login-title">Sign in to continue</h1>
        <p className="login-subtitle">
          Workflow health &amp; latency monitoring for Appointy.
        </p>

        <div className="login-btn-area">
          {loading ? (
            <div className="login-loading">
              <span className="spinner" />
              Signing in…
            </div>
          ) : (
            <div ref={btnRef} />
          )}
        </div>

        {error && (
          <div className="login-error">
            {isDomainError ? (
              <>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <circle cx="7" cy="7" r="6.25" stroke="currentColor" strokeWidth="1.25"/>
                  <line x1="7" y1="4.5" x2="7" y2="7.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
                  <circle cx="7" cy="9.5" r="0.7" fill="currentColor"/>
                </svg>
                Only <strong>@appointy.com</strong> accounts are permitted.
              </>
            ) : (
              error
            )}
          </div>
        )}

        <p className="login-note">Access is restricted to Appointy employees.</p>
      </div>
    </div>
  );
}
