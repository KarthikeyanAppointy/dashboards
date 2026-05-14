import { useState, useEffect, useCallback } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import Sidebar from "./components/Sidebar";
import TenantSelector from "./components/TenantSelector";
import DashboardPage from "./pages/DashboardPage";
import RecentFailuresPage from "./pages/RecentFailuresPage";
import ActivityErrorsPage from "./pages/ActivityErrorsPage";
import P100LatencyPage from "./pages/P100LatencyPage";
import SesDashboardPage from "./pages/SesDashboardPage";
import LoginPage from "./pages/LoginPage";

import "./App.css";

const LS_KEY = "slo_dashboard_tenant_id";

const PAGE_META = {
  "/": {
    eyebrow: "Pages / Overview",
    title: "Background SLO Dashboard",
    description:
      "Track workflow health, latency, and operational drift across tenants in one view.",
  },
  "/recent-failures": {
    eyebrow: "Pages / Workflows",
    title: "Recent Failures",
    description:
      "Inspect failed and timed out executions with pagination and tasklist filters.",
  },
  "/activity-errors": {
    eyebrow: "Pages / Diagnostics",
    title: "Activity Errors",
    description:
      "Review activity failure patterns and raw error details without leaving the dashboard.",
  },
  "/p100-latency": {
    eyebrow: "Pages / Performance",
    title: "P100 Latency",
    description:
      "Compare worst-case latency by workflow window to spot slow paths quickly.",
  },
  "/ses": {
    eyebrow: "Pages / AWS",
    title: "SES Delivery Dashboard",
    description:
      "Monitor AWS SES send volumes, bounce rates, complaint rates, and overall delivery health.",
  },
};

function App() {
  const { user, checking, signOut, authFetch } = useAuth();
  const location = useLocation();
  const pageMeta = PAGE_META[location.pathname] ?? PAGE_META["/"];

  // Show a blank screen while validating a stored token
  if (checking) return null;

  // Not signed in → login page
  if (!user) return <LoginPage />;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const [tenants, setTenants] = useState([]);
  const [selectedTenantId, setSelectedTenantId] = useState(() => {
    const saved = localStorage.getItem(LS_KEY);
    return saved ? Number(saved) : null;
  });

  const [limit, setLimit] = useState(() => {
    const saved = localStorage.getItem("slo_dashboard_limit");
    return saved ? Number(saved) : 20;
  });

  const [tasklistWindow, setTasklistWindow] = useState(() => {
    const saved = localStorage.getItem("slo_dashboard_tasklist_window");
    return saved ? Number(saved) : 3600;
  });

  const [statusFilter, setStatusFilter] = useState(() => {
    const saved = localStorage.getItem("slo_dashboard_status_filter");
    return saved ? saved.split(",") : ["Failed", "TimedOut"];
  });

  const [activityStatusFilter, setActivityStatusFilter] = useState(() => {
    const saved = localStorage.getItem("slo_dashboard_activity_status_filter");
    return saved ? saved.split(",") : [];
  });

  const [activityErrorDetailField, setActivityErrorDetailField] = useState(
    () => {
      const saved = localStorage.getItem(
        "slo_dashboard_activity_error_detail_field",
      );
      return saved || "";
    },
  );

  const [tasklistFilter, setTasklistFilter] = useState(() => {
    const saved = localStorage.getItem("slo_dashboard_tasklist_filter");
    return saved ? saved.split(",") : [];
  });

  const [availableTasklists, setAvailableTasklists] = useState([]);

  const [startTime, setStartTime] = useState(() => {
    const saved = localStorage.getItem("slo_dashboard_start_time");
    return saved ? Number(saved) : null;
  });
  const [endTime, setEndTime] = useState(() => {
    const saved = localStorage.getItem("slo_dashboard_end_time");
    return saved ? Number(saved) : null;
  });

  const [offset, setOffset] = useState(0);
  const [totalFailed, setTotalFailed] = useState(0);
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("slo_dashboard_theme");
    return saved || "light";
  });

  const [autoRefresh, setAutoRefresh] = useState(() => {
    const saved = localStorage.getItem("slo_dashboard_auto_refresh");
    return saved === null ? true : saved === "true";
  });

  const toggleAutoRefresh = () => {
    setAutoRefresh((prev) => {
      const next = !prev;
      localStorage.setItem("slo_dashboard_auto_refresh", String(next));
      return next;
    });
  };

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("slo_dashboard_theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  };

  const fetchTenants = useCallback(async () => {
    try {
      const res = await authFetch("/api/tenants");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = await res.json();
      setTenants(list);
      return list;
    } catch (err) {
      console.error("Failed to load tenants:", err);
      return [];
    }
  }, [authFetch]);

  useEffect(() => {
    fetchTenants().then((list) => {
      if (list.length > 0) {
        const saved = localStorage.getItem(LS_KEY);
        const savedId = saved ? Number(saved) : null;
        const exists = list.some((tenant) => tenant.id === savedId);
        if (!exists) {
          setSelectedTenantId(list[0].id);
          localStorage.setItem(LS_KEY, String(list[0].id));
        }
      }
    });
  }, [fetchTenants]);

  const buildQueryString = useCallback(() => {
    const params = new URLSearchParams();
    params.set("tenant_id", selectedTenantId);
    params.set("limit", limit);
    params.set("tasklist_window", tasklistWindow);
    if (statusFilter.length > 0 && statusFilter.length < 2) {
      params.set("status_filter", statusFilter.join(","));
    }
    if (tasklistFilter.length > 0) {
      params.set("tasklist_filter", tasklistFilter.join(","));
    }
    if (startTime) {
      params.set("start_time", String(Math.floor(startTime)));
    }
    if (endTime) {
      params.set("end_time", String(Math.floor(endTime)));
    }
    if (offset > 0) {
      params.set("offset", String(offset));
    }
    if (activityStatusFilter.length > 0) {
      params.set("activity_status_filter", activityStatusFilter.join(","));
    }
    if (activityErrorDetailField) {
      params.set("activity_error_detail_field", activityErrorDetailField);
    }
    return params.toString();
  }, [
    selectedTenantId,
    limit,
    tasklistWindow,
    statusFilter,
    tasklistFilter,
    startTime,
    endTime,
    offset,
    activityStatusFilter,
    activityErrorDetailField,
  ]);

  const fetchData = useCallback(async () => {
    if (!selectedTenantId) return;

    try {
      setLoading(true);
      const qs = buildQueryString();
      const response = await authFetch(`/api/workflows?${qs}`);
      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const json = await response.json();
      setData(json);
      setLastUpdated(new Date().toLocaleTimeString());
      setError(null);

      const tasklistSet = new Set();
      if (json.tasklist_latency) {
        json.tasklist_latency.forEach((tasklist) => {
          if (tasklist.tasklist) tasklistSet.add(tasklist.tasklist);
        });
      }
      if (json.recent_failed) {
        json.recent_failed.forEach((failure) => {
          if (failure.tasklist) tasklistSet.add(failure.tasklist);
        });
      }
      if (tasklistFilter.length > 0) {
        tasklistFilter.forEach((tasklist) => tasklistSet.add(tasklist));
      }

      setAvailableTasklists(Array.from(tasklistSet).sort());
      setTotalFailed(json.total_failed || 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [authFetch, buildQueryString, selectedTenantId, tasklistFilter]);

  useEffect(() => {
    if (selectedTenantId) {
      fetchData();
    }
  }, [fetchData, selectedTenantId]);

  useEffect(() => {
    if (!selectedTenantId || !autoRefresh) return;
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData, selectedTenantId, autoRefresh]);

  const handleTenantSelect = (id) => {
    setSelectedTenantId(id);
    localStorage.setItem(LS_KEY, String(id));
  };

  const handleLimitChange = (newLimit) => {
    setLimit(newLimit);
    localStorage.setItem("slo_dashboard_limit", String(newLimit));
  };

  const handleTasklistWindowChange = (newWindow) => {
    setTasklistWindow(newWindow);
    localStorage.setItem("slo_dashboard_tasklist_window", String(newWindow));
  };

  const handleStatusFilterChange = (newFilter) => {
    setStatusFilter(newFilter);
    localStorage.setItem("slo_dashboard_status_filter", newFilter.join(","));
  };

  const handleActivityStatusFilterChange = (newFilter) => {
    setActivityStatusFilter(newFilter);
    localStorage.setItem(
      "slo_dashboard_activity_status_filter",
      newFilter.join(","),
    );
  };

  const handleActivityErrorDetailFieldChange = (newField) => {
    setActivityErrorDetailField(newField);
    localStorage.setItem("slo_dashboard_activity_error_detail_field", newField);
  };

  const handleTasklistFilterChange = (newFilter) => {
    setTasklistFilter(newFilter);
    localStorage.setItem("slo_dashboard_tasklist_filter", newFilter.join(","));
  };

  const handleStartTimeChange = (newTime) => {
    setStartTime(newTime);
    setOffset(0);
    localStorage.setItem(
      "slo_dashboard_start_time",
      newTime ? String(newTime) : "",
    );
  };

  const handleEndTimeChange = (newTime) => {
    setEndTime(newTime);
    setOffset(0);
    localStorage.setItem(
      "slo_dashboard_end_time",
      newTime ? String(newTime) : "",
    );
  };

  const handleOffsetChange = (newOffset) => {
    setOffset(newOffset);
  };

  const tsToDt = (ts) => {
    if (!ts) return "";
    const date = new Date(ts * 1000);
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
      date.getDate(),
    )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  const dtToTs = (dt) => {
    if (!dt) return null;
    const date = new Date(dt);
    return Math.floor(date.getTime() / 1000);
  };

  const WINDOW_OPTIONS = [
    { label: "Last 1h", value: 3600 },
    { label: "Last 3h", value: 10800 },
    { label: "Last 6h", value: 21600 },
    { label: "Last 12h", value: 43200 },
    { label: "Last 1d", value: 86400 },
  ];

  const clearDates = () => {
    handleStartTimeChange(null);
    handleEndTimeChange(null);
  };

  return (
    <div className="app-shell">
      <Sidebar domainName={data?.domain_name} />

      <div className="app-stage">
        <header className="app-topbar">
          <div className="topbar-row topbar-row-title">
            <h1 className="topbar-title">{pageMeta.title}</h1>

            <div className="topbar-actions">
              {data?.domain_name && (
                <div className="meta-pill meta-pill-domain">
                  {data.domain_name}
                </div>
              )}
              {loading ? (
                <div className="meta-pill meta-pill-live">
                  <span className="spinner-tiny" />
                  Refreshing
                </div>
              ) : lastUpdated ? (
                <div className="meta-pill">Updated {lastUpdated}</div>
              ) : null}

              {location.pathname !== "/ses" && (
                <button
                  className={`topbar-auto-refresh-btn${autoRefresh ? " active" : ""}`}
                  onClick={toggleAutoRefresh}
                  title={
                    autoRefresh
                      ? "Auto-refresh on — click to pause"
                      : "Auto-refresh paused — click to enable"
                  }
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 13 13"
                    fill="none"
                    aria-hidden="true"
                  >
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
                  {autoRefresh ? "Auto" : "Paused"}
                </button>
              )}
              <button className="topbar-primary-btn" onClick={fetchData}>
                Refresh
              </button>
              <button
                className="theme-toggle"
                onClick={toggleTheme}
                title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
                aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
              >
                {theme === "light" ? (
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 15 15"
                    fill="none"
                    aria-hidden="true"
                  >
                    <circle
                      cx="7.5"
                      cy="7.5"
                      r="3"
                      stroke="currentColor"
                      strokeWidth="1.3"
                    />
                    <line
                      x1="7.5"
                      y1="1"
                      x2="7.5"
                      y2="2.5"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                    />
                    <line
                      x1="7.5"
                      y1="12.5"
                      x2="7.5"
                      y2="14"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                    />
                    <line
                      x1="1"
                      y1="7.5"
                      x2="2.5"
                      y2="7.5"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                    />
                    <line
                      x1="12.5"
                      y1="7.5"
                      x2="14"
                      y2="7.5"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                    />
                    <line
                      x1="3.05"
                      y1="3.05"
                      x2="4.11"
                      y2="4.11"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                    />
                    <line
                      x1="10.89"
                      y1="10.89"
                      x2="11.95"
                      y2="11.95"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                    />
                    <line
                      x1="11.95"
                      y1="3.05"
                      x2="10.89"
                      y2="4.11"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                    />
                    <line
                      x1="4.11"
                      y1="10.89"
                      x2="3.05"
                      y2="11.95"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                    />
                  </svg>
                ) : (
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 15 15"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M12.5 9.5A6 6 0 015.5 2.5a6 6 0 100 10 6 6 0 007-3z"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
              <TenantSelector
                tenants={tenants}
                selectedTenantId={selectedTenantId}
                onSelect={handleTenantSelect}
              />

              <div className="topbar-user">
                {user.picture ? (
                  <img
                    src={user.picture}
                    alt={user.name ?? user.email}
                    className="topbar-avatar"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="topbar-avatar topbar-avatar-initials">
                    {(user.name ?? user.email ?? "?")[0].toUpperCase()}
                  </div>
                )}
                <button
                  className="topbar-signout-btn"
                  onClick={signOut}
                  title="Sign out"
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 13 13"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M5 2H2a1 1 0 00-1 1v7a1 1 0 001 1h3"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                    />
                    <polyline
                      points="9,9 12,6.5 9,4"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <line
                      x1="12"
                      y1="6.5"
                      x2="5"
                      y2="6.5"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <div className="topbar-row topbar-row-controls">
            <div className="toolbar-group">
              <span className="toolbar-label">Window</span>
              <select
                className="toolbar-select"
                value={tasklistWindow}
                onChange={(e) =>
                  handleTasklistWindowChange(Number(e.target.value))
                }
              >
                {WINDOW_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="topbar-separator" />

            <div className="toolbar-group">
              <span className="toolbar-label">From</span>
              <input
                type="datetime-local"
                className="toolbar-datetime"
                value={tsToDt(startTime)}
                onChange={(e) => handleStartTimeChange(dtToTs(e.target.value))}
              />
              <span className="toolbar-label">To</span>
              <input
                type="datetime-local"
                className="toolbar-datetime"
                value={tsToDt(endTime)}
                onChange={(e) => handleEndTimeChange(dtToTs(e.target.value))}
              />
              {(startTime || endTime) && (
                <button className="toolbar-clear-btn" onClick={clearDates}>
                  Clear
                </button>
              )}
            </div>
          </div>
        </header>

        {error && (
          <div className="error-banner">
            <span className="error-icon">!</span>
            <span>Connection error: {error}. Auto-refresh will continue.</span>
          </div>
        )}

        <main className="app-main">
          {data && (
            <div className="app-content">
              <Routes>
                <Route
                  path="/"
                  element={
                    <DashboardPage
                      data={data}
                      tasklistWindow={tasklistWindow}
                    />
                  }
                />
                <Route
                  path="/recent-failures"
                  element={
                    <RecentFailuresPage
                      data={data}
                      limit={limit}
                      onLimitChange={handleLimitChange}
                      statusFilter={statusFilter}
                      onStatusFilterChange={handleStatusFilterChange}
                      tasklistFilter={tasklistFilter}
                      onTasklistFilterChange={handleTasklistFilterChange}
                      availableTasklists={availableTasklists}
                      offset={offset}
                      onOffsetChange={handleOffsetChange}
                      totalFailed={totalFailed}
                    />
                  }
                />
                <Route
                  path="/activity-errors"
                  element={
                    <ActivityErrorsPage
                      data={data}
                      activityStatusFilter={activityStatusFilter}
                      onActivityStatusFilterChange={
                        handleActivityStatusFilterChange
                      }
                      activityErrorDetailField={activityErrorDetailField}
                      onActivityErrorDetailFieldChange={
                        handleActivityErrorDetailFieldChange
                      }
                    />
                  }
                />
                <Route
                  path="/p100-latency"
                  element={<P100LatencyPage data={data} />}
                />
                <Route path="/ses" element={null} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </div>
          )}

          {location.pathname === "/ses" && (
            <div className="app-content">
              <SesDashboardPage />
            </div>
          )}

          {!data &&
            !error &&
            selectedTenantId &&
            location.pathname !== "/ses" && (
              <div className="initial-loading card-surface">
                <div className="spinner"></div>
                <p>Loading dashboard data...</p>
              </div>
            )}

          {!selectedTenantId && !error && location.pathname !== "/ses" && (
            <div className="initial-loading card-surface">
              <p>No tenants configured. Add tenants via the API.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
