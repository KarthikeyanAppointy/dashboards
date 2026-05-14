import { useState } from "react";
import { NavLink } from "react-router-dom";
import "./Sidebar.css";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: "◈" },
  {
    to: "/recent-failures",
    label: "Recent Failed / Timed Out Workflows",
    icon: "⚠",
  },
  { to: "/activity-errors", label: "Activity Errors", icon: "✕" },
  { to: "/p100-latency", label: "P100 Latencies", icon: "◉" },
];

function Sidebar() {
  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem("slo_dashboard_sidebar_collapsed");
    return saved === "true";
  });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("slo_dashboard_sidebar_collapsed", next);
      return next;
    });
  };

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="sidebar-header">
        <img
          className="sidebar-logo"
          src="https://cdn.appointy.com/master/images/branding/icon.png"
          alt="Appointy"
        />
        <span className="sidebar-brand">SLO Dashboard</span>
      </div>
      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              `sidebar-link ${isActive ? "active" : ""}`
            }
            title={collapsed ? item.label : undefined}
          >
            <span className="sidebar-link-icon">{item.icon}</span>
            <span className="sidebar-link-label">{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <button
        className="sidebar-collapse-btn"
        onClick={toggleCollapsed}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <span className="sidebar-collapse-icon">
          {collapsed ? "\u25B6" : "\u25C0"}
        </span>
      </button>
    </aside>
  );
}

export default Sidebar;
