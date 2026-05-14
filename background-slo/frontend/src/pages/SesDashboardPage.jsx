import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../auth/AuthContext";
import SesMetrics from "../components/SesMetrics";

const PERIOD_OPTIONS = [
  { label: "Last 1 hour", hours: 1 },
  { label: "Last 6 hours", hours: 6 },
  { label: "Last 12 hours", hours: 12 },
  { label: "Last 1 day", hours: 24 },
  { label: "Last 7 days", hours: 168 },
  { label: "Last 14 days", hours: 336 },
  { label: "Last 30 days", hours: 720 },
  { label: "Last 90 days", hours: 2160 },
];

function SesDashboardPage() {
  const { authFetch } = useAuth();
  const [sesData, setSesData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [periodID, setPeriodID] = useState(() => {
    const saved = localStorage.getItem("slo_dashboard_ses_period");
    return saved ? Number(saved) : 4; // default: 7 days (index 4)
  });
  const [region, setRegion] = useState(() => {
    return localStorage.getItem("slo_dashboard_ses_region") || "us-east-1";
  });
  const [regions, setRegions] = useState(["us-east-1"]);

  const selectedPeriod = PERIOD_OPTIONS[periodID] ?? PERIOD_OPTIONS[4];

  // Fetch available regions on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch("/api/ses-regions");
        if (res.ok) {
          const json = await res.json();
          if (json.regions && json.regions.length > 0) {
            setRegions(json.regions);
          }
        }
      } catch {
        // ignore, use defaults
      }
    })();
  }, [authFetch]);

  const fetchSesData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await authFetch(
        `/api/ses-metrics?period_hours=${selectedPeriod.hours}&region=${region}`,
      );
      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }
      const json = await response.json();
      setSesData(json);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [authFetch, selectedPeriod.hours, region]);

  useEffect(() => {
    fetchSesData();
  }, [fetchSesData]);

  const handleRegionChange = (newRegion) => {
    setRegion(newRegion);
    localStorage.setItem("slo_dashboard_ses_region", newRegion);
  };

  const handlePeriodChange = (id) => {
    setPeriodID(id);
    localStorage.setItem("slo_dashboard_ses_period", String(id));
  };

  return (
    <SesMetrics
      data={sesData}
      loading={loading}
      error={error}
      periodOptions={PERIOD_OPTIONS}
      periodID={periodID}
      onPeriodChange={handlePeriodChange}
      regions={regions}
      region={region}
      onRegionChange={handleRegionChange}
      onRefresh={fetchSesData}
    />
  );
}

export default SesDashboardPage;
