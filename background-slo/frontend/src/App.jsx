import { useState, useEffect, useCallback } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import SummaryCards from "./components/SummaryCards";
import WorkflowTable from "./components/WorkflowTable";
import TasklistLatency from "./components/TasklistLatency";
import RecentFailures from "./components/RecentFailures";
import ActivityErrors from "./components/ActivityErrors";
import P100LatencyByWorkflow from "./components/P100LatencyByWorkflow";
import Sidebar from "./components/Sidebar";
import TenantSelector from "./components/TenantSelector";
import DashboardPage from "./pages/DashboardPage";
import RecentFailuresPage from "./pages/RecentFailuresPage";
import ActivityErrorsPage from "./pages/ActivityErrorsPage";
import P100LatencyPage from "./pages/P100LatencyPage";

import "./App.css";

const LS_KEY = "slo_dashboard_tenant_id";

function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Tenant state
  const [tenants, setTenants] = useState([]);
  const [selectedTenantId, setSelectedTenantId] = useState(() => {
    const saved = localStorage.getItem(LS_KEY);
    return saved ? Number(saved) : null;
  });

  // Limit state for recent failures
  const [limit, setLimit] = useState(() => {
    const saved = localStorage.getItem("slo_dashboard_limit");
    return saved ? Number(saved) : 20;
  });

  // Tasklist window state (in seconds)
  const [tasklistWindow, setTasklistWindow] = useState(() => {
    const saved = localStorage.getItem("slo_dashboard_tasklist_window");
    return saved ? Number(saved) : 3600;
  });

  // Status filter state for recent failures
  const [statusFilter, setStatusFilter] = useState(() => {
    const saved = localStorage.getItem("slo_dashboard_status_filter");
    return saved ? saved.split(",") : ["Failed", "TimedOut"];
  });

  // Status filter state for activity errors (empty = all)
  const [activityStatusFilter, setActivityStatusFilter] = useState(() => {
    const saved = localStorage.getItem("slo_dashboard_activity_status_filter");
    return saved ? saved.split(",") : [];
  });

  // Activity error detail field name (ES field for actual error messages)
  const [activityErrorDetailField, setActivityErrorDetailField] = useState(
    () => {
      const saved = localStorage.getItem(
        "slo_dashboard_activity_error_detail_field",
      );
      return saved || "";
    },
  );

  // Tasklist filter state for recent failures
  const [tasklistFilter, setTasklistFilter] = useState(() => {
    const saved = localStorage.getItem("slo_dashboard_tasklist_filter");
    return saved ? saved.split(",") : [];
  });

  // Derive unique available tasklists from response data
  const [availableTasklists, setAvailableTasklists] = useState([]);

  // Date/time range state for recent failures (Unix timestamps in seconds)
  const [startTime, setStartTime] = useState(() => {
    const saved = localStorage.getItem("slo_dashboard_start_time");
    return saved ? Number(saved) : null; // null = no filter
  });
  const [endTime, setEndTime] = useState(() => {
    const saved = localStorage.getItem("slo_dashboard_end_time");
    return saved ? Number(saved) : null; // null = no filter
  });

  // Pagination state for recent failures
  const [offset, setOffset] = useState(0);

  // Total failed count from API response
  const [totalFailed, setTotalFailed] = useState(0);

  // Theme state
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem("slo_dashboard_theme");
    return saved || "light";
  });

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("slo_dashboard_theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  };

  // Fetch tenants list
  const fetchTenants = useCallback(async () => {
    try {
      const res = await fetch("/api/tenants");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = await res.json();
      setTenants(list);
      return list;
    } catch (err) {
      console.error("Failed to load tenants:", err);
      return [];
    }
  }, []);

  // Load tenants on mount and set default
  useEffect(() => {
    fetchTenants().then((list) => {
      if (list.length > 0) {
        const saved = localStorage.getItem(LS_KEY);
        const savedId = saved ? Number(saved) : null;
        const exists = list.some((t) => t.id === savedId);
        if (!exists) {
          // Default to first tenant
          setSelectedTenantId(list[0].id);
          localStorage.setItem(LS_KEY, String(list[0].id));
        }
      }
    });
  }, [fetchTenants]);

  // Build the query string for fetching workflow data
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

  // Fetch workflow data for the selected tenant
  const fetchData = useCallback(async () => {
    if (!selectedTenantId) return;
    try {
      setLoading(true);
      const qs = buildQueryString();
      const response = await fetch(`/api/workflows?${qs}`);
      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }
      const json = await response.json();
      setData(json);
      setLastUpdated(new Date().toLocaleTimeString());
      setError(null);

      // Extract unique tasklists from the response
      const tasklistSet = new Set();
      if (json.tasklist_latency) {
        json.tasklist_latency.forEach((t) => {
          if (t.tasklist) tasklistSet.add(t.tasklist);
        });
      }
      if (json.recent_failed) {
        json.recent_failed.forEach((f) => {
          if (f.tasklist) tasklistSet.add(f.tasklist);
        });
      }
      // Always include selected tasklists so they don't disappear from the dropdown
      if (tasklistFilter.length > 0) {
        tasklistFilter.forEach((tl) => tasklistSet.add(tl));
      }
      setAvailableTasklists(Array.from(tasklistSet).sort());
      setTotalFailed(json.total_failed || 0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [buildQueryString]);

  // Fetch on mount and when tenant or limit changes
  useEffect(() => {
    if (selectedTenantId) {
      fetchData();
    }
  }, [fetchData, selectedTenantId]);

  // Poll every 10s
  useEffect(() => {
    if (!selectedTenantId) return;
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData, selectedTenantId]);

  // Handle tenant selection
  const handleTenantSelect = (id) => {
    setSelectedTenantId(id);
    localStorage.setItem(LS_KEY, String(id));
  };

  // Handle limit change
  const handleLimitChange = (newLimit) => {
    setLimit(newLimit);
    localStorage.setItem("slo_dashboard_limit", String(newLimit));
  };

  // Handle tasklist window change
  const handleTasklistWindowChange = (newWindow) => {
    setTasklistWindow(newWindow);
    localStorage.setItem("slo_dashboard_tasklist_window", String(newWindow));
  };

  // Handle status filter change
  const handleStatusFilterChange = (newFilter) => {
    setStatusFilter(newFilter);
    localStorage.setItem("slo_dashboard_status_filter", newFilter.join(","));
  };

  // Handle activity status filter change
  const handleActivityStatusFilterChange = (newFilter) => {
    setActivityStatusFilter(newFilter);
    localStorage.setItem(
      "slo_dashboard_activity_status_filter",
      newFilter.join(","),
    );
  };

  // Handle activity error detail field change
  const handleActivityErrorDetailFieldChange = (newField) => {
    setActivityErrorDetailField(newField);
    localStorage.setItem("slo_dashboard_activity_error_detail_field", newField);
  };

  // Handle tasklist filter change
  const handleTasklistFilterChange = (newFilter) => {
    setTasklistFilter(newFilter);
    localStorage.setItem("slo_dashboard_tasklist_filter", newFilter.join(","));
  };

  // Handle start time change
  const handleStartTimeChange = (newTime) => {
    setStartTime(newTime);
    setOffset(0); // Reset pagination when filter changes
    localStorage.setItem(
      "slo_dashboard_start_time",
      newTime ? String(newTime) : "",
    );
  };

  // Handle end time change
  const handleEndTimeChange = (newTime) => {
    setEndTime(newTime);
    setOffset(0); // Reset pagination when filter changes
    localStorage.setItem(
      "slo_dashboard_end_time",
      newTime ? String(newTime) : "",
    );
  };

  // Handle offset change (pagination)
  const handleOffsetChange = (newOffset) => {
    setOffset(newOffset);
  };

  // Convert Unix timestamp (seconds) to datetime-local string value
  const tsToDt = (ts) => {
    if (!ts) return "";
    const d = new Date(ts * 1000);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  // Convert datetime-local string value to Unix timestamp (seconds)
  const dtToTs = (dt) => {
    if (!dt) return null;
    const d = new Date(dt);
    return Math.floor(d.getTime() / 1000);
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
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <h1 className="header-title">
            <img
              className="header-logo"
              src="https://cdn.appointy.com/master/images/branding/icon.png"
              alt="Appointy"
            />
            Background SLO Dashboard
          </h1>
          {data && data.domain_name && (
            <span className="header-domain">{data.domain_name}</span>
          )}
        </div>
        <div className="header-right">
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
          >
            {theme === "light" ? "\u263D" : "\u2600"}
          </button>
          <TenantSelector
            tenants={tenants}
            selectedTenantId={selectedTenantId}
            onSelect={handleTenantSelect}
          />
          {loading && <span className="loading-indicator">Refreshing...</span>}
          {lastUpdated && (
            <span className="last-updated">Last updated: {lastUpdated}</span>
          )}
        </div>
      </header>

      {error && (
        <div className="error-banner">
          <span className="error-icon">&#9888;</span>
          Connection error: {error}. Retrying every 5s...
        </div>
      )}

      <div className="app-toolbar">
        <div className="toolbar-group">
          <span className="toolbar-label">Window:</span>
          <select
            className="toolbar-select"
            value={tasklistWindow}
            onChange={(e) => handleTasklistWindowChange(Number(e.target.value))}
          >
            {WINDOW_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="toolbar-group">
          <span className="toolbar-label">From:</span>
          <input
            type="datetime-local"
            className="toolbar-datetime"
            value={tsToDt(startTime)}
            onChange={(e) => handleStartTimeChange(dtToTs(e.target.value))}
          />
          <span className="toolbar-label">To:</span>
          <input
            type="datetime-local"
            className="toolbar-datetime"
            value={tsToDt(endTime)}
            onChange={(e) => handleEndTimeChange(dtToTs(e.target.value))}
          />
          {(startTime || endTime) && (
            <button className="toolbar-clear-btn" onClick={clearDates}>
              Clear Dates
            </button>
          )}
        </div>
      </div>

      <main className="app-main">
        {data && (
          <div className="app-layout">
            <Sidebar />
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
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </div>
          </div>
        )}
        {!data && !error && selectedTenantId && (
          <div className="initial-loading">
            <div className="spinner"></div>
            <p>Loading dashboard data...</p>
          </div>
        )}
        {!selectedTenantId && !error && (
          <div className="initial-loading">
            <p>No tenants configured. Add tenants via the API.</p>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
