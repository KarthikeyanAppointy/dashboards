import { createContext, useContext, useState, useEffect, useCallback } from "react";

const AuthContext = createContext(null);

const TOKEN_KEY = "slo_auth_token";
const USER_KEY  = "slo_auth_user";

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser]   = useState(() => {
    const s = localStorage.getItem(USER_KEY);
    return s ? JSON.parse(s) : null;
  });
  // true while we're verifying a stored token on first load
  const [checking, setChecking] = useState(!!localStorage.getItem(TOKEN_KEY));

  // On mount, validate any stored token against /api/auth/me
  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) { setChecking(false); return; }

    fetch("/api/auth/me", { headers: { Authorization: `Bearer ${stored}` } })
      .then((r) => {
        if (!r.ok) throw new Error("expired");
        return r.json();
      })
      .then((data) => {
        setUser(data);
        setToken(stored);
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        setUser(null);
        setToken(null);
      })
      .finally(() => setChecking(false));
  }, []);

  const signIn = useCallback((sessionToken, userInfo) => {
    localStorage.setItem(TOKEN_KEY, sessionToken);
    localStorage.setItem(USER_KEY, JSON.stringify(userInfo));
    setToken(sessionToken);
    setUser(userInfo);
  }, []);

  const signOut = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
    window.google?.accounts?.id?.disableAutoSelect();
  }, []);

  // Drop-in fetch replacement that injects the Bearer token
  const authFetch = useCallback(
    (url, options = {}) =>
      fetch(url, {
        ...options,
        headers: { ...options.headers, Authorization: `Bearer ${token}` },
      }),
    [token],
  );

  return (
    <AuthContext.Provider value={{ user, token, checking, signIn, signOut, authFetch }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
