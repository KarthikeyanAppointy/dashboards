import { useState } from "react";
import { NavLink } from "react-router-dom";
import "./Sidebar.css";

const IconOverview = () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 15 15"
    fill="none"
    aria-hidden="true"
  >
    <rect x="1" y="1" width="5.5" height="5.5" rx="1.25" fill="currentColor" />
    <rect
      x="8.5"
      y="1"
      width="5.5"
      height="5.5"
      rx="1.25"
      fill="currentColor"
    />
    <rect
      x="1"
      y="8.5"
      width="5.5"
      height="5.5"
      rx="1.25"
      fill="currentColor"
    />
    <rect
      x="8.5"
      y="8.5"
      width="5.5"
      height="5.5"
      rx="1.25"
      fill="currentColor"
    />
  </svg>
);

const IconFailures = () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 15 15"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M7.5 1.5L13.5 12H1.5L7.5 1.5Z"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinejoin="round"
    />
    <line
      x1="7.5"
      y1="5.5"
      x2="7.5"
      y2="8.5"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
    />
    <circle cx="7.5" cy="10.5" r="0.7" fill="currentColor" />
  </svg>
);

const IconActivity = () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 15 15"
    fill="none"
    aria-hidden="true"
  >
    <rect
      x="2"
      y="1.5"
      width="11"
      height="12"
      rx="1.5"
      stroke="currentColor"
      strokeWidth="1.25"
    />
    <line
      x1="4.5"
      y1="5"
      x2="10.5"
      y2="5"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
    />
    <line
      x1="4.5"
      y1="7.5"
      x2="10.5"
      y2="7.5"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
    />
    <line
      x1="4.5"
      y1="10"
      x2="8"
      y2="10"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
    />
  </svg>
);

const IconLatency = () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 15 15"
    fill="none"
    aria-hidden="true"
  >
    <circle cx="7.5" cy="7.5" r="6" stroke="currentColor" strokeWidth="1.25" />
    <path
      d="M7.5 4.5V7.75L9.5 9.25"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const IconSES = () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 15 15"
    fill="none"
    aria-hidden="true"
  >
    <rect
      x="1.5"
      y="2.5"
      width="12"
      height="10"
      rx="1.5"
      stroke="currentColor"
      strokeWidth="1.25"
    />
    <path
      d="M1.5 4.5L7.5 8.5L13.5 4.5"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const IconHistory = () => (
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
      r="5.5"
      stroke="currentColor"
      strokeWidth="1.25"
    />
    <path
      d="M7.5 4V7.5L9.5 9"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M4 2.5L2 4"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
    />
  </svg>
);

const IconAlerts = () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 15 15"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M7.5 1.5C4.5 1.5 2.5 4 2.5 7V10L1 12H14L12.5 10V7C12.5 4 10.5 1.5 7.5 1.5Z"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinejoin="round"
    />
    <path
      d="M9.5 12C9.5 13.5 8.5 14 7.5 14C6.5 14 5.5 13.5 5.5 12"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
    />
  </svg>
);

const IconPeople = () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 15 15"
    fill="none"
    aria-hidden="true"
  >
    <circle
      cx="5.5"
      cy="4.5"
      r="2.5"
      stroke="currentColor"
      strokeWidth="1.25"
    />
    <path
      d="M1 13C1 10.5 3 9 5.5 9S10 10.5 10 13"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
    />
    <circle cx="11" cy="5" r="2" stroke="currentColor" strokeWidth="1.2" />
    <path
      d="M14 12.5C14 10.8 12.7 9.5 11 9.5C10.3 9.5 9.6 9.7 9.1 10.1"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
  </svg>
);

const IconAdmin = () => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 15 15"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M7.5 1.5C4.5 1.5 2 4 2 7v5l2-1 1.5 1L7 11l1.5 1L10 11l2 1V7c0-3-2.5-5.5-5.5-5.5z"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinejoin="round"
    />
    <circle cx="7.5" cy="6.5" r="2" fill="currentColor" />
  </svg>
);

const NAV_SECTIONS = [
  {
    label: "Monitoring",
    items: [
      { to: "/", label: "Overview", Icon: IconOverview },
      { to: "/recent-failures", label: "Failures", Icon: IconFailures },
      { to: "/activity-errors", label: "Activity Errors", Icon: IconActivity },
      { to: "/p100-latency", label: "P100 Latency", Icon: IconLatency },
    ],
  },
  {
    label: "Delivery",
    items: [
      { to: "/ses", label: "SES", Icon: IconSES },
      {
        to: "/pipeline-requests",
        label: "Pipeline Requests",
        Icon: IconHistory,
      },
    ],
  },
  {
    label: "Config",
    items: [
      { to: "/notifications", label: "Notifications", Icon: IconAlerts },
      { to: "/report-history", label: "Reports", Icon: IconHistory },
    ],
  },
  {
    label: "Access",
    items: [{ to: "/peoples", label: "People", Icon: IconPeople }],
  },
  {
    label: "Admin",
    items: [{ to: "/admin/clients", label: "Clients", Icon: IconAdmin }],
  },
];

function Sidebar({ domainName, userPermissions }) {
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

  // Map route to permission key
  const routeToPerm = {
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

  return (
    <aside className={`sidebar${collapsed ? " collapsed" : ""}`}>
      <div className="sidebar-header">
        <img
          src="https://cdn.appointy.com/master/images/branding/icon.png"
          alt="Appointy"
          className="sidebar-logo"
        />
        {!collapsed && (
          <div className="sidebar-brand-block">
            <span className="sidebar-brand">Background SLO</span>
          </div>
        )}
      </div>

      <nav className="sidebar-nav">
        {NAV_SECTIONS.map((section) => {
          const visibleItems = section.items.filter((item) => {
            const required = routeToPerm[item.to];
            if (!required) return true;
            return userPermissions.includes(required);
          });
          if (visibleItems.length === 0) return null;

          return (
            <div key={section.label} className="sidebar-section">
              {!collapsed && (
                <span className="sidebar-section-label">{section.label}</span>
              )}
              {visibleItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  className={({ isActive }) =>
                    `sidebar-link${isActive ? " active" : ""}`
                  }
                  title={collapsed ? item.label : undefined}
                >
                  <span className="sidebar-link-icon">
                    <item.Icon />
                  </span>
                  {!collapsed && (
                    <span className="sidebar-link-label">{item.label}</span>
                  )}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        {!collapsed && domainName && (
          <div className="sidebar-scope">
            <span className="sidebar-scope-label">Active scope</span>
            <span className="sidebar-scope-value">{domainName}</span>
          </div>
        )}
        <button
          className="sidebar-collapse-btn"
          onClick={toggleCollapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 13 13"
            fill="none"
            aria-hidden="true"
          >
            {collapsed ? (
              <path
                d="M4 2L8 6.5L4 11"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : (
              <path
                d="M9 2L5 6.5L9 11"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </svg>
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;
