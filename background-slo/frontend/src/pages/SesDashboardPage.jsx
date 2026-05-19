import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../auth/AuthContext";
import SesMetrics from "../components/SesMetrics";
import AlertSetupModal from "./AlertSetupModal";

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

const ALL_METRICS = [
  { key: "sends", label: "Total Sends" },
  { key: "bounces", label: "Bounces" },
  { key: "complaints", label: "Complaints" },
  { key: "rejects", label: "Rejects" },
  { key: "bounce_rate", label: "Bounce Rate" },
  { key: "complaint_rate", label: "Complaint Rate" },
  { key: "error_rate", label: "Error Rate" },
  { key: "daily_volume", label: "Daily Volume" },
];

function SesDashboardPage({ selectedTenantId, notificationsEnabled }) {
  const { authFetch } = useAuth();
  const [sesData, setSesData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [periodID, setPeriodID] = useState(() => {
    const saved = localStorage.getItem("slo_dashboard_ses_period");
    return saved ? Number(saved) : 4;
  });
  const [selectedRegions, setSelectedRegions] = useState(new Set());
  const [regions, setRegions] = useState([]);
  const [selectedMetrics, setSelectedMetrics] = useState(() => {
    const saved = localStorage.getItem("slo_dashboard_ses_metrics");
    return saved
      ? new Set(saved.split(","))
      : new Set(ALL_METRICS.map((m) => m.key));
  });

  /* ─── Alert state ──────────────────────────────────────────── */
  const [alertModal, setAlertModal] = useState(null);
  const [activeAlerts, setActiveAlerts] = useState(new Set());

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

  useEffect(() => {
    fetchAlertRules();
  }, [fetchAlertRules]);

  const selectedPeriod = PERIOD_OPTIONS[periodID] ?? PERIOD_OPTIONS[4];

  // Fetch available regions
  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch("/api/ses-regions");
        if (res.ok) {
          const json = await res.json();
          if (json.regions && json.regions.length > 0) {
            setRegions(json.regions);
            setSelectedRegions(new Set(json.regions));
          }
        }
      } catch {
        // ignore
      }
    })();
  }, [authFetch]);

  // Toggle a region on/off
  const toggleRegion = (r) => {
    setSelectedRegions((prev) => {
      const next = new Set(prev);
      if (next.has(r)) {
        next.delete(r);
      } else {
        next.add(r);
      }
      return next;
    });
  };

  // Toggle all regions
  const toggleAllRegions = () => {
    if (selectedRegions.size === regions.length) {
      setSelectedRegions(new Set());
    } else {
      setSelectedRegions(new Set(regions));
    }
  };

  // Toggle a metric on/off
  const toggleMetric = (key) => {
    setSelectedMetrics((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      localStorage.setItem(
        "slo_dashboard_ses_metrics",
        Array.from(next).join(","),
      );
      return next;
    });
  };

  // Fetch data for all selected regions
  const fetchSesData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      if (selectedRegions.size === 0) {
        setSesData(null);
        setLoading(false);
        return;
      }

      // Fetch data for each selected region in parallel
      const results = await Promise.all(
        Array.from(selectedRegions).map(async (r) => {
          try {
            const res = await authFetch(
              `/api/ses-metrics?period_hours=${selectedPeriod.hours}&region=${r}`,
            );
            if (res.ok) return await res.json();
          } catch {
            // ignore
          }
          return null;
        }),
      );

      const validResults = results.filter(Boolean);
      if (validResults.length === 0) {
        setError("No data available for selected regions");
        setSesData(null);
        setLoading(false);
        return;
      }

      // Aggregate data across regions
      const aggregated = {
        sends: 0,
        bounces: 0,
        permanent_bounces: 0,
        transient_bounces: 0,
        complaints: 0,
        rejects: 0,
        bounce_rate: "0.0000%",
        complaint_rate: "0.0000%",
        error_rate: "0.0000%",
        daily_volume: [],
        timestamp: new Date().toISOString(),
      };

      // Sum numeric fields
      for (const d of validResults) {
        aggregated.sends += d.sends || 0;
        aggregated.bounces += d.bounces || 0;
        aggregated.permanent_bounces += d.permanent_bounces || 0;
        aggregated.transient_bounces += d.transient_bounces || 0;
        aggregated.complaints += d.complaints || 0;
        aggregated.rejects += d.rejects || 0;
      }

      // Aggregate daily volume by summing matching dates
      const volumeMap = {};
      for (const d of validResults) {
        if (d.daily_volume) {
          for (const day of d.daily_volume) {
            if (!volumeMap[day.date]) {
              volumeMap[day.date] = {
                date: day.date,
                sends: 0,
                bounces: 0,
                complaints: 0,
              };
            }
            volumeMap[day.date].sends += day.sends || 0;
            volumeMap[day.date].bounces += day.bounces || 0;
            volumeMap[day.date].complaints += day.complaints || 0;
          }
        }
      }
      aggregated.daily_volume = Object.values(volumeMap).sort((a, b) =>
        a.date.localeCompare(b.date),
      );

      // Calculate rates
      if (aggregated.sends > 0) {
        aggregated.bounce_rate =
          ((aggregated.bounces / aggregated.sends) * 100).toFixed(4) + "%";
        aggregated.complaint_rate =
          ((aggregated.complaints / aggregated.sends) * 100).toFixed(4) + "%";
        aggregated.error_rate =
          (
            ((aggregated.bounces + aggregated.complaints + aggregated.rejects) /
              aggregated.sends) *
            100
          ).toFixed(4) + "%";
      }

      setSesData(aggregated);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [authFetch, selectedPeriod.hours, selectedRegions]);

  useEffect(() => {
    if (selectedRegions.size > 0) fetchSesData();
  }, [fetchSesData]);

  const handlePeriodChange = (id) => {
    setPeriodID(id);
    localStorage.setItem("slo_dashboard_ses_period", String(id));
  };

  return (
    <>
      <SesMetrics
        data={sesData}
        loading={loading}
        error={error}
        periodOptions={PERIOD_OPTIONS}
        periodID={periodID}
        onPeriodChange={handlePeriodChange}
        regions={regions}
        selectedRegions={selectedRegions}
        onToggleRegion={toggleRegion}
        onToggleAllRegions={toggleAllRegions}
        onRefresh={fetchSesData}
        allMetrics={ALL_METRICS}
        selectedMetrics={selectedMetrics}
        onToggleMetric={toggleMetric}
        activeAlerts={activeAlerts}
        onAlertSetup={({ tileId, tileLabel }) =>
          setAlertModal({ tileId, tileLabel })
        }
        notificationsEnabled={notificationsEnabled}
      />

      {alertModal && (
        <AlertSetupModal
          isOpen={true}
          onClose={() => {
            setAlertModal(null);
            fetchAlertRules();
          }}
          tenantId={selectedTenantId}
          tileId={alertModal.tileId}
          tileLabel={alertModal.tileLabel}
          existingRule={null}
          onSaved={() => {
            setAlertModal(null);
            fetchAlertRules();
          }}
        />
      )}
    </>
  );
}

export default SesDashboardPage;
