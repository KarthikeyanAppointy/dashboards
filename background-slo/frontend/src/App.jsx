import { useState, useEffect, useCallback, useRef } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import Sidebar from "./components/Sidebar";
import TenantSelector from "./components/TenantSelector";
import DashboardPage from "./pages/DashboardPage";
import RecentFailuresPage from "./pages/RecentFailuresPage";
import ActivityErrorsPage from "./pages/ActivityErrorsPage";
import P100LatencyPage from "./pages/P100LatencyPage";
import SesDashboardPage from "./pages/SesDashboardPage";
import NotificationsPage from "./pages/NotificationsPage";
import ReportHistoryPage from "./pages/ReportHistoryPage";
import PipelineErrorsPage from "./pages/PipelineErrorsPage";
import LoginPage from "./pages/LoginPage";
import PeoplesPage from "./pages/PeoplesPage";
import TenantsPage from "./pages/TenantsPage";
import WelcomePage from "./pages/WelcomePage";

// Route-to-permission mapping (must match Sidebar.jsx)
const ROUTE_PERM = {
  "/": "overview",
  "/recent-failures": "failures",
  "/activity-errors": "activity-errors",
  "/p100-latency": "p100-latency",
  "/ses": "ses",
  "/notifications": "notifications",
  "/pipeline-requests": "pipeline-requests",
  "/report-history": "report-history",
  "/peoples": "peoples",
  "/admin/clients": "admin",
};

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
  "/notifications": {
    eyebrow: "Pages / Notifications",
    title: "Notifications & Alerts",
    description:
      "Configure notification channels, alert rules, and scheduled reports.",
  },
  "/pipeline-requests": {
    eyebrow: "Pages / Delivery",
    title: "Pipeline Requests",
    description:
      "Review pipeline trigger requests, delivery status, and requests skipped because the same workflow type and error were already handled.",
  },
  "/report-history": {
    eyebrow: "Pages / Reports",
    title: "Report History",
    description: "History of triggered alerts and scheduled reports.",
  },
  "/peoples": {
    eyebrow: "Pages / Admin",
    title: "People",
    description: "Manage user roles and permissions across tenants.",
  },
  "/admin/clients": {
    eyebrow: "Pages / Admin",
    title: "Clients",
    description: "Manage and configure client tenants.",
  },
};

function normalizeActivityStatus(status) {
  return String(status || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/_/g, "");
}

function isFailedTimeoutOnlyFilter(statuses) {
  return (
    Array.isArray(statuses) &&
    statuses.length > 0 &&
    statuses.every((status) => {
      const normalized = normalizeActivityStatus(status);
      return (
        normalized === "failed" ||
        normalized === "timeout" ||
        normalized === "timedout"
      );
    })
  );
}

function App() {
  const { user, checking } = useAuth();

  if (checking) return null;
  if (!user) return <LoginPage />;

  return <AppContent />;
}

function AppContent() {
  const { user, signOut, authFetch } = useAuth();
  const location = useLocation();
  const pageMeta = PAGE_META[location.pathname] ?? PAGE_META["/"];

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const workflowsAbortRef = useRef(null);

  const [tenants, setTenants] = useState([]);
  const [userAssignedTenantIds, setUserAssignedTenantIds] = useState(null);
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

  const [tasklistFilter, setTasklistFilter] = useState(() => {
    const saved = localStorage.getItem("slo_dashboard_tasklist_filter");
    return saved ? saved.split(",") : [];
  });
  const [workflowCategory, setWorkflowCategory] = useState(() => {
    return localStorage.getItem("slo_dashboard_workflow_category") || "";
  });
  const [recipientEmailFilter, setRecipientEmailFilter] = useState(() => {
    return localStorage.getItem("slo_dashboard_recipient_email") || "";
  });
  const [historySearchFilter, setHistorySearchFilter] = useState("");

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
  const [alertModal, setAlertModal] = useState(null);
  const [activeAlerts, setActiveAlerts] = useState(new Set());
  const [userPermissions, setUserPermissions] = useState([]);
  const [userPersona, setUserPersona] = useState("Developer");
  const [userRole, setUserRole] = useState("user");
  const [accessChecked, setAccessChecked] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);

  // Snackbar state for Apple-style toast notifications
  const [snackbar, setSnackbar] = useState({
    message: "",
    type: "success",
    visible: false,
  });
  const showSnackbar = useCallback((message, type = "success") => {
    setSnackbar({ message, type, visible: true });
    setTimeout(() => {
      setSnackbar((prev) => ({ ...prev, visible: false }));
    }, 3000);
  }, []);

  // Whether the user can access a given route path
  const canAccess = useCallback(
    (path) => {
      const required = ROUTE_PERM[path];
      if (!required) return true;

      return userPermissions.includes(required);
    },
    [userPermissions],
  );

  // Whether alert / pipeline-trigger buttons are visible
  const notificationsEnabled =
    userPermissions && userPermissions.includes("notifications");

  const fetchAlertRules = useCallback(async () => {
    if (!selectedTenantId) return;
    try {
      const res = await authFetch(
        `/api/alerts/rules?tenant_id=${selectedTenantId}`,
      );
      if (res.ok) {
        const json = await res.json();
        const rules = Array.isArray(json) ? json : (json.rules ?? []);
        const tileIds = new Set();
        rules.forEach((r) => {
          if (r.tile_id) tileIds.add(r.tile_id);
        });
        setActiveAlerts(tileIds);
      }
    } catch {
      // ignore
    }
  }, [authFetch, selectedTenantId]);

  const fetchPermissions = useCallback(async () => {
    if (!selectedTenantId) return;
    try {
      const res = await authFetch(`/api/rbac?tenant_id=${selectedTenantId}`);
      if (res.ok) {
        const json = await res.json();
        setUserPermissions(json.permissions || []);
        setUserPersona(json.persona || "Developer");
        setUserRole(json.role || "user");
        setAccessChecked(true);
      }
    } catch {
      setUserPersona("Developer");
      setUserRole("user");
      setAccessChecked(true);
    }
  }, [authFetch, selectedTenantId]);

  useEffect(() => {
    fetchAlertRules();
    fetchPermissions();
  }, [fetchAlertRules, fetchPermissions]);

  // Show welcome page when access is confirmed to be empty
  useEffect(() => {
    if (accessChecked) {
      const noPermissions = selectedTenantId && userPermissions.length === 0;
      const noAccess =
        !selectedTenantId &&
        Array.isArray(tenants) &&
        tenants.length === 0 &&
        userAssignedTenantIds !== null;
      setShowWelcome(noPermissions || noAccess);
    }
  }, [
    accessChecked,
    selectedTenantId,
    userPermissions,
    tenants,
    userAssignedTenantIds,
  ]);

  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("slo_dashboard_theme");
    return saved || "light";
  });

  const [autoRefresh, setAutoRefresh] = useState(() => {
    const saved = localStorage.getItem("slo_dashboard_auto_refresh");
    return saved === null ? true : saved === "true";
  });
  const autoRefreshPausedByHistorySearch =
    location.pathname === "/recent-failures" &&
    !workflowCategory &&
    historySearchFilter.trim().length > 0;

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

  const fetchUserAssignedTenants = useCallback(async () => {
    if (!user?.email) return null;
    try {
      const res = await authFetch(
        `/api/rbac/user-tenants?user_email=${encodeURIComponent(user.email)}`,
      );
      if (res.ok) {
        const list = await res.json();
        const ids = new Set(list.map((ut) => ut.tenant_id));
        setUserAssignedTenantIds(ids);
        return ids;
      }
    } catch {}
    setUserAssignedTenantIds(null);
    return null;
  }, [authFetch, user?.email]);

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
    fetchTenants().then(async (list) => {
      const assignedSet = await fetchUserAssignedTenants();
      // assignedSet is null while loading, or a Set (possibly empty) when loaded
      const accessible =
        assignedSet !== null ? list.filter((t) => assignedSet.has(t.id)) : list;
      if (accessible.length > 0) {
        const saved = localStorage.getItem(LS_KEY);
        const savedId = saved ? Number(saved) : null;
        const exists = accessible.some((t) => t.id === savedId);
        if (!exists || (assignedSet !== null && !assignedSet.has(savedId))) {
          setSelectedTenantId(accessible[0].id);
          localStorage.setItem(LS_KEY, String(accessible[0].id));
        }
      } else {
        setSelectedTenantId(null);
        localStorage.removeItem(LS_KEY);
        setAccessChecked(true);
      }
    });
  }, [fetchTenants, fetchUserAssignedTenants]);

  const buildQueryString = useCallback(() => {
    const params = new URLSearchParams();
    const effectiveStatusFilter =
      location.pathname === "/activity-errors" &&
      isFailedTimeoutOnlyFilter(activityStatusFilter)
        ? activityStatusFilter
        : statusFilter;
    params.set("tenant_id", selectedTenantId);
    params.set("limit", limit);
    params.set("tasklist_window", tasklistWindow);
    if (effectiveStatusFilter.length > 0 && effectiveStatusFilter.length < 2) {
      params.set("status_filter", effectiveStatusFilter.join(","));
    }
    if (tasklistFilter.length > 0) {
      params.set("tasklist_filter", tasklistFilter.join(","));
    }
    if (workflowCategory) {
      params.set("workflow_category", workflowCategory);
    }
    if (workflowCategory === "email" && recipientEmailFilter.trim()) {
      params.set("email_search", recipientEmailFilter.trim());
    }
    if (!workflowCategory && historySearchFilter.trim()) {
      params.set("history_search", historySearchFilter.trim());
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
    return params.toString();
  }, [
    location.pathname,
    selectedTenantId,
    limit,
    tasklistWindow,
    statusFilter,
    tasklistFilter,
    workflowCategory,
    recipientEmailFilter,
    historySearchFilter,
    startTime,
    endTime,
    offset,
    activityStatusFilter,
  ]);

  const fetchData = useCallback(async () => {
    if (!selectedTenantId) return;

    const controller = new AbortController();
    workflowsAbortRef.current?.abort();
    workflowsAbortRef.current = controller;

    try {
      setLoading(true);
      const qs = buildQueryString();
      const response = await authFetch(`/api/workflows?${qs}`, {
        signal: controller.signal,
      });
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
      if (err.name === "AbortError") return;
      setError(err.message);
    } finally {
      if (workflowsAbortRef.current === controller) {
        workflowsAbortRef.current = null;
        setLoading(false);
      }
    }
  }, [authFetch, buildQueryString, selectedTenantId, tasklistFilter]);

  useEffect(() => {
    if (selectedTenantId) {
      fetchData();
    }
  }, [fetchData, selectedTenantId]);

  useEffect(() => {
    if (!selectedTenantId || !autoRefresh || autoRefreshPausedByHistorySearch)
      return;
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [
    fetchData,
    selectedTenantId,
    autoRefresh,
    autoRefreshPausedByHistorySearch,
  ]);

  const handleTenantSelect = (id) => {
    setSelectedTenantId(id);
    localStorage.setItem(LS_KEY, String(id));
  };

  const handleLimitChange = (newLimit) => {
    setLimit(newLimit);
    setOffset(0);
    localStorage.setItem("slo_dashboard_limit", String(newLimit));
  };

  const handleTasklistWindowChange = (newWindow) => {
    setTasklistWindow(newWindow);
    setOffset(0);
    // Clear date range when a window is selected
    setStartTime(null);
    setEndTime(null);
    localStorage.setItem("slo_dashboard_tasklist_window", String(newWindow));
    localStorage.removeItem("slo_dashboard_start_time");
    localStorage.removeItem("slo_dashboard_end_time");
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

  const handleTasklistFilterChange = (newFilter) => {
    setTasklistFilter(newFilter);
    setOffset(0);
    localStorage.setItem("slo_dashboard_tasklist_filter", newFilter.join(","));
  };

  const handleWorkflowCategoryChange = (category) => {
    setWorkflowCategory(category);
    setOffset(0);
    localStorage.setItem("slo_dashboard_workflow_category", category);
    if (category !== "email") {
      setRecipientEmailFilter("");
      localStorage.removeItem("slo_dashboard_recipient_email");
    }
    if (category !== "") {
      setHistorySearchFilter("");
    }
  };

  const handleRecipientEmailFilterChange = (email) => {
    setRecipientEmailFilter(email);
    setOffset(0);
    localStorage.setItem("slo_dashboard_recipient_email", email);
  };

  const handleHistorySearchFilterChange = (search) => {
    setHistorySearchFilter(search);
    setOffset(0);
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
    { label: "Last 1w", value: 604800 },
    { label: "Last 30d", value: 2592000 },
  ];

  const clearDates = () => {
    handleStartTimeChange(null);
    handleEndTimeChange(null);
  };

  return (
    <div className="app-shell">
      <Sidebar
        domainName={data?.domain_name}
        userPermissions={userPermissions}
      />

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
                  className={`topbar-auto-refresh-btn${autoRefresh && !autoRefreshPausedByHistorySearch ? " active" : ""}`}
                  onClick={toggleAutoRefresh}
                  title={
                    autoRefreshPausedByHistorySearch
                      ? "Auto-refresh paused while history search is active"
                      : autoRefresh
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
                  {autoRefreshPausedByHistorySearch
                    ? "Search"
                    : autoRefresh
                      ? "Auto"
                      : "Paused"}
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

          {/* Only show window/date controls on dashboard pages that need them */}
          {(location.pathname === "/" ||
            location.pathname === "/recent-failures" ||
            location.pathname === "/activity-errors" ||
            location.pathname === "/p100-latency") && (
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
                  onChange={(e) =>
                    handleStartTimeChange(dtToTs(e.target.value))
                  }
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
          )}
        </header>

        {error && (
          <div className="error-banner">
            <span className="error-icon">!</span>
            <span>Connection error: {error}. Auto-refresh will continue.</span>
          </div>
        )}

        <main className="app-main">
          {data && !showWelcome && (
            <div className="app-content">
              <Routes>
                <Route
                  path="/"
                  element={
                    <DashboardPage
                      data={data}
                      tasklistWindow={tasklistWindow}
                      selectedTenantId={selectedTenantId}
                      activeAlerts={activeAlerts}
                      onAlertSetup={({ tileId, tileLabel }) =>
                        setAlertModal({ tileId, tileLabel })
                      }
                      alertModal={alertModal}
                      onCloseAlertModal={() => {
                        setAlertModal(null);
                        fetchAlertRules();
                      }}
                      notificationsEnabled={notificationsEnabled}
                    />
                  }
                />
                <Route
                  path="/recent-failures"
                  element={
                    canAccess("/recent-failures") ? (
                      <RecentFailuresPage
                        data={data}
                        loading={loading}
                        limit={limit}
                        onLimitChange={handleLimitChange}
                        statusFilter={statusFilter}
                        onStatusFilterChange={handleStatusFilterChange}
                        tasklistFilter={tasklistFilter}
                        onTasklistFilterChange={handleTasklistFilterChange}
                        workflowCategory={workflowCategory}
                        onWorkflowCategoryChange={handleWorkflowCategoryChange}
                        recipientEmailFilter={recipientEmailFilter}
                        onRecipientEmailFilterChange={
                          handleRecipientEmailFilterChange
                        }
                        historySearchFilter={historySearchFilter}
                        onHistorySearchFilterChange={
                          handleHistorySearchFilterChange
                        }
                        availableTasklists={availableTasklists}
                        showLimitSelector={tasklistWindow >= 604800}
                        offset={offset}
                        onOffsetChange={handleOffsetChange}
                        totalFailed={totalFailed}
                        activeAlerts={activeAlerts}
                        onAlertSetup={({ tileId, tileLabel }) =>
                          setAlertModal({ tileId, tileLabel })
                        }
                        selectedTenantId={selectedTenantId}
                        selectedTenant={tenants.find(
                          (t) => t.id === selectedTenantId,
                        )}
                        notificationsEnabled={notificationsEnabled}
                        userPersona={userPersona}
                        userRole={userRole}
                      />
                    ) : (
                      <Navigate to="/" replace />
                    )
                  }
                />
                <Route
                  path="/activity-errors"
                  element={
                    canAccess("/activity-errors") ? (
                      <ActivityErrorsPage
                        data={data}
                        activityStatusFilter={activityStatusFilter}
                        onActivityStatusFilterChange={
                          handleActivityStatusFilterChange
                        }
                      />
                    ) : (
                      <Navigate to="/" replace />
                    )
                  }
                />
                <Route
                  path="/p100-latency"
                  element={
                    canAccess("/p100-latency") ? (
                      <P100LatencyPage data={data} />
                    ) : (
                      <Navigate to="/" replace />
                    )
                  }
                />
                <Route
                  path="/ses"
                  element={
                    canAccess("/ses") ? null : <Navigate to="/" replace />
                  }
                />
                <Route
                  path="/notifications"
                  element={
                    canAccess("/notifications") ? null : (
                      <Navigate to="/" replace />
                    )
                  }
                />
                <Route
                  path="/pipeline-requests"
                  element={
                    canAccess("/pipeline-requests") ? null : (
                      <Navigate to="/" replace />
                    )
                  }
                />
                <Route
                  path="/report-history"
                  element={
                    canAccess("/report-history") ? null : (
                      <Navigate to="/" replace />
                    )
                  }
                />
                <Route
                  path="/peoples"
                  element={
                    canAccess("/peoples") ? null : <Navigate to="/" replace />
                  }
                />
                <Route
                  path="/admin/clients"
                  element={
                    canAccess("/admin/clients") ? null : (
                      <Navigate to="/" replace />
                    )
                  }
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </div>
          )}

          {location.pathname === "/ses" &&
            canAccess("/ses") &&
            !showWelcome && (
              <div className="app-content">
                <SesDashboardPage
                  selectedTenantId={selectedTenantId}
                  notificationsEnabled={notificationsEnabled}
                />
              </div>
            )}

          {location.pathname === "/notifications" &&
            canAccess("/notifications") &&
            !showWelcome && (
              <div className="app-content">
                <NotificationsPage
                  selectedTenantId={selectedTenantId}
                  showSnackbar={showSnackbar}
                />
              </div>
            )}

          {location.pathname === "/pipeline-requests" &&
            canAccess("/pipeline-requests") &&
            !showWelcome && (
              <div className="app-content">
                <PipelineErrorsPage
                  selectedTenantId={selectedTenantId}
                  userPersona={userPersona}
                  userRole={userRole}
                />
              </div>
            )}

          {location.pathname === "/report-history" &&
            canAccess("/report-history") &&
            !showWelcome && (
              <div className="app-content">
                <ReportHistoryPage selectedTenantId={selectedTenantId} />
              </div>
            )}

          {location.pathname === "/peoples" &&
            canAccess("/peoples") &&
            !showWelcome && (
              <div className="app-content">
                <PeoplesPage
                  selectedTenantId={selectedTenantId}
                  showSnackbar={showSnackbar}
                  userPersona={userPersona}
                />
              </div>
            )}

          {location.pathname === "/admin/clients" &&
            canAccess("/admin/clients") &&
            !showWelcome && (
              <div className="app-content">
                <TenantsPage showSnackbar={showSnackbar} />
              </div>
            )}

          {!showWelcome &&
            !data &&
            !error &&
            selectedTenantId &&
            location.pathname !== "/ses" &&
            location.pathname !== "/notifications" &&
            location.pathname !== "/pipeline-requests" &&
            location.pathname !== "/report-history" &&
            location.pathname !== "/peoples" &&
            location.pathname !== "/admin/clients" && (
              <div className="initial-loading card-surface">
                <div className="spinner"></div>
                <p>Loading dashboard data...</p>
              </div>
            )}

          {showWelcome && (
            <div className="app-content" style={{ padding: 0 }}>
              <WelcomePage
                missingSections={Boolean(
                  selectedTenantId && userPermissions.length === 0,
                )}
                onAccessGranted={() => {
                  setShowWelcome(false);
                  fetchPermissions();
                }}
              />
            </div>
          )}

          {!showWelcome &&
            !selectedTenantId &&
            !error &&
            location.pathname !== "/ses" &&
            location.pathname !== "/notifications" &&
            location.pathname !== "/pipeline-requests" &&
            location.pathname !== "/report-history" &&
            location.pathname !== "/peoples" &&
            location.pathname !== "/admin/clients" && (
              <div className="initial-loading card-surface">
                <div className="spinner"></div>
                <p>No clients assigned to your account.</p>
                <p
                  style={{
                    fontSize: "12px",
                    color: "var(--fg-tertiary)",
                    marginTop: "4px",
                  }}
                >
                  Contact an administrator to grant you access.
                </p>
              </div>
            )}
        </main>
      </div>

      {/* ─── Snackbar Toast ──────────────────────────────────── */}
      <div
        className={`snackbar snackbar-${snackbar.type}${snackbar.visible ? " snackbar-visible" : ""}`}
      >
        {snackbar.message}
      </div>
    </div>
  );
}

export default App;
