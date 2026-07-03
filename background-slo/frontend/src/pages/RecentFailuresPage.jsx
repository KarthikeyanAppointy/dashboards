import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../auth/AuthContext";
import RecentFailures from "../components/RecentFailures";

function RecentFailuresPage({
  data,
  loading,
  limit,
  onLimitChange,
  statusFilter,
  onStatusFilterChange,
  tasklistFilter,
  onTasklistFilterChange,
  workflowCategory,
  onWorkflowCategoryChange,
  recipientEmailFilter,
  onRecipientEmailFilterChange,
  historySearchFilter,
  onHistorySearchFilterChange,
  availableTasklists,
  showLimitSelector,
  offset,
  onOffsetChange,
  totalFailed,
  activeAlerts,
  onAlertSetup,
  selectedTenantId,
  selectedTenant,
  notificationsEnabled,
  userPersona,
  userRole,
}) {
  const { authFetch } = useAuth();
  const [codefacPipelines, setCodefacPipelines] = useState([]);

  const fetchCodefacPipelines = useCallback(async () => {
    if (!selectedTenantId) {
      setCodefacPipelines([]);
      return;
    }
    try {
      const res = await authFetch(
        `/api/codefac-pipelines?tenant_id=${selectedTenantId}`,
      );
      if (res.ok) {
        const json = await res.json();
        setCodefacPipelines(Array.isArray(json) ? json : []);
      }
    } catch {
      // ignore
    }
  }, [authFetch, selectedTenantId]);

  useEffect(() => {
    fetchCodefacPipelines();
  }, [fetchCodefacPipelines]);

  const handleTriggerPipeline = async (pipelineId, workflow) => {
    if (!selectedTenantId) return;
    const res = await authFetch(
      `/api/codefac-pipelines/trigger?tenant_id=${selectedTenantId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipeline_id: pipelineId,
          workflow_id: workflow.workflow_id,
          run_id: workflow.run_id,
          workflow_type: workflow.workflow_type,
          tasklist: workflow.tasklist,
          status: workflow.status,
          close_time: workflow.close_time,
          domain: workflow.domain || data?.domain_name || "",
        }),
      },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.detail ?? `HTTP error ${res.status}`);
    }
  };

  return (
    <RecentFailures
      failures={data.recent_failed}
      loading={loading}
      limit={limit}
      onLimitChange={onLimitChange}
      statusFilter={statusFilter}
      onStatusFilterChange={onStatusFilterChange}
      tasklistFilter={tasklistFilter}
      onTasklistFilterChange={onTasklistFilterChange}
      workflowCategory={workflowCategory}
      onWorkflowCategoryChange={onWorkflowCategoryChange}
      recipientEmailFilter={recipientEmailFilter}
      onRecipientEmailFilterChange={onRecipientEmailFilterChange}
      historySearchFilter={historySearchFilter}
      onHistorySearchFilterChange={onHistorySearchFilterChange}
      availableTasklists={availableTasklists}
      showLimitSelector={showLimitSelector}
      offset={offset}
      onOffsetChange={onOffsetChange}
      totalFailed={totalFailed}
      activeAlerts={activeAlerts}
      onAlertSetup={onAlertSetup}
      codefacPipelines={codefacPipelines}
      onTriggerPipeline={handleTriggerPipeline}
      selectedTenantId={selectedTenantId}
      selectedTenant={selectedTenant}
      notificationsEnabled={notificationsEnabled}
      userPersona={userPersona}
      userRole={userRole}
    />
  );
}

export default RecentFailuresPage;
